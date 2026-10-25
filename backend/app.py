"""
app.py - Flask REST API for the Wi-Fi Dead-Zone & Signal Mapping System.

Runs ON THE SAME LAPTOP that is walked around: the background sampler
(sampler.py) reads this laptop's own Wi-Fi adapter every second.

Endpoints
  GET    /api/health                      server + database status
  GET    /api/stream                      live Server-Sent Events: "sample" every 1 s,
                                          "reading" whenever a reading is saved/deleted
  GET    /api/history                     last 120 samples (fills the graph on page load)
  GET    /api/rssi                        latest single sample
  GET    /api/networks                    nearby networks + recommended 2.4 GHz channel
  GET    /api/surveys                     list surveys
  POST   /api/surveys                     create {name, width, height, plan?}
  GET    /api/surveys/<id>                one survey (with plan image + router)
  PATCH  /api/surveys/<id>                change name / size / plan / router
  DELETE /api/surveys/<id>                delete survey and its readings
  GET    /api/surveys/<id>/readings       list readings
  POST   /api/surveys/<id>/measure        {x, y, samples} -> average N fresh samples (mode "measure")
  POST   /api/surveys/<id>/walk           {x, y}          -> quick 3-sample reading (mode "walk")
  POST   /api/surveys/<id>/readings       {x, y, rssi}    -> manual entry (mode "manual")
  DELETE /api/readings/<id>               delete one reading
  GET    /api/surveys/<id>/map            heatmap grid, dead zones, extender, stats
  GET    /api/surveys/<id>/calibration    path-loss model fitted to this survey
  GET    /api/surveys/<id>/whatif?x=&y=   predicted heatmap if the router moved to (x, y)
  GET    /api/surveys/<id>/export.csv     readings as a CSV file

Start:  python app.py          (dashboard on this laptop only)
        python app.py --lan    (also reachable from a phone on the same Wi-Fi)
"""

import csv
import io
import json
import platform
import queue
import statistics
import sys

from dotenv import load_dotenv
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

import channels
import db
import mapping
from sampler import sampler

load_dotenv()                      # reads backend/.env (SUPABASE_URL, SUPABASE_KEY)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024   # 8 MB max request (floor-plan image)
CORS(app)                          # allow the Vite dev server to call us

store, db_message = db.connect()
print(f"[db] mode={store.mode}: {db_message}")

RSSI_MIN, RSSI_MAX = -110, -10     # anything outside this is not a real Wi-Fi reading
SAMPLES_DEFAULT, SAMPLES_MIN, SAMPLES_MAX = 10, 3, 30
WALK_SAMPLES = 3


# ------------------------------------------------------------------ helpers
class ApiError(Exception):
    """Raise this anywhere -> client gets {"error": message} with a status code."""
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message, self.status = message, status


@app.errorhandler(ApiError)
def handle_api_error(err):
    return jsonify({"error": err.message}), err.status


@app.errorhandler(db.SchemaOutdated)
def handle_schema_outdated(err):
    return jsonify({"error": str(err)}), 409


@app.errorhandler(404)
def handle_404(_err):
    return jsonify({"error": "Not found."}), 404


@app.errorhandler(405)
def handle_405(_err):
    return jsonify({"error": "Method not allowed."}), 405


@app.errorhandler(413)
def handle_413(_err):
    return jsonify({"error": "Request too large (max 8 MB). Use a smaller floor-plan image."}), 413


@app.errorhandler(Exception)
def handle_unexpected(err):
    if isinstance(err, HTTPException):          # other HTTP errors keep their own code
        return jsonify({"error": err.description}), err.code
    app.logger.exception(err)
    return jsonify({"error": f"Server error: {err}"}), 500


def body():
    """JSON body of the request as a dict (empty dict if missing)."""
    data = request.get_json(silent=True)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object.")
    return data


def number(data, key, low=None, high=None, required=True):
    """Read a numeric field and check its range."""
    value = data.get(key)
    if value is None or value == "":
        if required:
            raise ApiError(f"'{key}' is required.")
        return None
    if isinstance(value, bool):
        raise ApiError(f"'{key}' must be a number.")
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ApiError(f"'{key}' must be a number.")
    if value != value:   # NaN
        raise ApiError(f"'{key}' must be a number.")
    if low is not None and value < low or high is not None and value > high:
        raise ApiError(f"'{key}' must be between {low} and {high} (got {value:g}).")
    return value


def find_survey(survey_id):
    survey = store.get_survey(survey_id)
    if not survey:
        raise ApiError("Survey not found.", 404)
    return survey


def point_in_floor(data, survey):
    """x, y must lie inside the floor (0..width, 0..height metres)."""
    x = number(data, "x", 0, survey["width"])
    y = number(data, "y", 0, survey["height"])
    return round(x, 2), round(y, 2)


def validate_survey_fields(data, partial=False):
    """Shared validation for POST (all fields) and PATCH (only given fields)."""
    fields = {}
    if "name" in data or not partial:
        name = str(data.get("name") or "").strip()
        if not name:
            raise ApiError("'name' is required.")
        if len(name) > 80:
            raise ApiError("'name' must be at most 80 characters.")
        fields["name"] = name
    for key in ("width", "height"):
        if key in data or not partial:
            fields[key] = number(data, key, 1, 200)
    if "plan" in data:
        plan = data["plan"]
        if plan not in (None, "") and (not isinstance(plan, str) or not plan.startswith("data:image/")):
            raise ApiError("'plan' must be an image data URL (data:image/...).")
        fields["plan"] = plan or None
    if "setup" in data:
        fields["setup"] = validate_setup(data["setup"])
    return fields


def validate_setup(setup):
    """Room directions for the guided survey (or null):
       corner = the real corner at the map's top-left (0, 0), e.g. "door corner"
       wall   = the real wall along the map's top edge, e.g. "window wall"
       step_m = the user's step length in metres (optional), to give directions in steps"""
    if setup is None:
        return None
    if not isinstance(setup, dict):
        raise ApiError("'setup' must be an object {corner, wall, step_m} or null.")
    clean = {}
    for key in ("corner", "wall"):
        text = str(setup.get(key) or "").strip()
        if not text:
            raise ApiError(f"'setup.{key}' is required (e.g. 'door corner', 'window wall').")
        if len(text) > 40:
            raise ApiError(f"'setup.{key}' must be at most 40 characters.")
        clean[key] = text
    step = number(setup, "step_m", 0.3, 1.2, required=False)
    clean["step_m"] = round(step, 2) if step else None
    return clean


# ------------------------------------------------------------------ status + live data
@app.get("/api/health")
def health():
    schema_ok = not getattr(store, "missing_columns", False) and getattr(store, "has_setup", True)
    return jsonify({"ok": True, "db": store.mode, "db_message": db_message, "schema_ok": schema_ok,
                    "platform": platform.system(), "gateway": sampler.gateway})


def sse(event, data):
    """Format one Server-Sent Event: 'event: name' + 'data: <json>' + blank line."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.get("/api/stream")
def stream():
    """Live stream. The browser's EventSource keeps this response open and
    receives every event the sampler publishes (and reconnects by itself)."""
    q = sampler.subscribe()

    def events():
        try:
            yield "retry: 2000\n\n"                     # reconnect after 2 s if dropped
            latest = sampler.latest()
            if latest:
                yield sse("sample", latest)
            while True:
                try:
                    event, data = q.get(timeout=15)
                    yield sse(event, data)
                except queue.Empty:
                    yield ": keep-alive\n\n"             # comment line keeps proxies happy
        finally:                                          # browser tab closed
            sampler.unsubscribe(q)

    return Response(events(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/history")
def history():
    return jsonify({"samples": sampler.history(), "quality": sampler.quality()})


@app.get("/api/rssi")
def live_rssi():
    latest = sampler.latest()
    if latest is None:
        raise ApiError("No sample yet - the sampler is starting.", 503)
    return jsonify(latest)


@app.get("/api/networks")
def networks():
    sampler.want_networks()                 # the Networks tab is open: keep scans fresh
    nets = sampler.networks
    return jsonify({"networks": nets, "time": sampler.networks_time, "error": sampler.networks_error,
                    **channels.recommend_24ghz(nets)})


# ------------------------------------------------------------------ surveys
@app.get("/api/surveys")
def list_surveys():
    return jsonify(store.list_surveys())


@app.post("/api/surveys")
def create_survey():
    survey = store.create_survey(validate_survey_fields(body()))
    return jsonify(survey), 201


@app.get("/api/surveys/<survey_id>")
def get_survey(survey_id):
    return jsonify(find_survey(survey_id))


@app.patch("/api/surveys/<survey_id>")
def update_survey(survey_id):
    survey = find_survey(survey_id)
    data = body()
    fields = validate_survey_fields(data, partial=True)
    size = {"width": fields.get("width", survey["width"]),
            "height": fields.get("height", survey["height"])}
    if "router" in data:
        # router is either null (removed) or a point {x, y} inside the floor.
        router = data["router"]
        if router is None:
            fields["router"] = None
        elif isinstance(router, dict):
            x, y = point_in_floor(router, size)
            fields["router"] = {"x": x, "y": y}
        else:
            raise ApiError("'router' must be {\"x\": .., \"y\": ..} or null.")
    if not fields:
        raise ApiError("Nothing to update. Send name, width, height, plan, router or setup.")
    updated = store.update_survey(survey_id, fields)
    sampler.publish("survey", {"survey_id": survey_id})   # other dashboards reload it
    return jsonify(updated)


@app.delete("/api/surveys/<survey_id>")
def delete_survey(survey_id):
    if not store.delete_survey(survey_id):
        raise ApiError("Survey not found.", 404)
    sampler.publish("survey", {"survey_id": survey_id, "deleted": True})
    return jsonify({"deleted": survey_id})


# ------------------------------------------------------------------ readings
@app.get("/api/surveys/<survey_id>/readings")
def list_readings(survey_id):
    find_survey(survey_id)
    return jsonify(store.list_readings(survey_id))


def summarise(samples):
    """Mean / standard deviation / min / max of a list of dBm samples."""
    return {
        "rssi_mean": round(statistics.fmean(samples), 2),
        "rssi_std": round(statistics.pstdev(samples), 2),
        "min": min(samples),
        "max": max(samples),
        "samples": samples,
    }


def collect(n):
    """Wait for n fresh samples from the background sampler (1 per second).
    Returns (rssi values, last good sample)."""
    try:
        fresh = sampler.wait_for_samples(n)
    except TimeoutError as exc:
        raise ApiError(str(exc), 503)
    good = [s for s in fresh if s["rssi"] is not None]
    if not good:
        raise ApiError(fresh[-1]["error"] or "No Wi-Fi reading available.", 503)
    if len(good) < min(n, SAMPLES_MIN):
        raise ApiError(f"Only {len(good)} of {n} samples succeeded: {fresh[-1]['error']}", 503)
    return [s["rssi"] for s in good], good[-1]


def save_reading(survey_id, x, y, values, mode, info=None):
    """Store a reading and tell every open dashboard about it."""
    info = info or {}
    reading = store.add_reading({
        "survey_id": survey_id, "x": x, "y": y, **summarise(values),
        "ssid": info.get("ssid"), "channel": info.get("channel"), "band": info.get("band"),
        "method": info.get("method") or mode, "mode": mode,
    })
    sampler.publish("reading", {"survey_id": survey_id, "action": "added", "reading": reading})
    return reading


@app.post("/api/surveys/<survey_id>/measure")
def measure(survey_id):
    """Average N fresh samples (1 s apart) at the user's position.
    Averaging smooths out the natural second-to-second fluctuation (fading)."""
    survey = find_survey(survey_id)
    data = body()
    x, y = point_in_floor(data, survey)
    n = int(number(data, "samples", required=False) or SAMPLES_DEFAULT)
    n = max(SAMPLES_MIN, min(SAMPLES_MAX, n))      # clamp to 3..30
    values, last = collect(n)
    return jsonify(save_reading(survey_id, x, y, values, "measure", last)), 201


@app.post("/api/surveys/<survey_id>/walk")
def walk(survey_id):
    """Walk mode: a quick 3-sample reading, saved immediately."""
    survey = find_survey(survey_id)
    x, y = point_in_floor(body(), survey)
    values, last = collect(WALK_SAMPLES)
    return jsonify(save_reading(survey_id, x, y, values, "walk", last)), 201


@app.post("/api/surveys/<survey_id>/readings")
def manual_reading(survey_id):
    """Manual entry, e.g. a value read from a phone app (one value = one sample)."""
    survey = find_survey(survey_id)
    data = body()
    x, y = point_in_floor(data, survey)
    rssi = round(number(data, "rssi", RSSI_MIN, RSSI_MAX), 1)
    info = {"ssid": data.get("ssid") or None, "method": "manual"}
    return jsonify(save_reading(survey_id, x, y, [rssi], "manual", info)), 201


@app.delete("/api/readings/<reading_id>")
def delete_reading(reading_id):
    if not store.delete_reading(reading_id):
        raise ApiError("Reading not found.", 404)
    sampler.publish("reading", {"action": "deleted", "id": reading_id})
    return jsonify({"deleted": reading_id})


# ------------------------------------------------------------------ analysis
def readings_on_floor(survey):
    """Readings that lie on the floor. If the survey was later made smaller,
    points now outside it are left out of the analysis (but not deleted)."""
    return [r for r in store.list_readings(survey["id"])
            if 0 <= r["x"] <= survey["width"] and 0 <= r["y"] <= survey["height"]]


@app.get("/api/surveys/<survey_id>/map")
def coverage_map(survey_id):
    survey = find_survey(survey_id)
    cell = number(request.args, "cell", 0.1, 2, required=False)   # None -> size-based default
    return jsonify(mapping.compute_map(survey["width"], survey["height"], readings_on_floor(survey), cell))


@app.get("/api/surveys/<survey_id>/calibration")
def calibration(survey_id):
    survey = find_survey(survey_id)
    return jsonify(mapping.calibrate(readings_on_floor(survey), survey.get("router")))


@app.get("/api/surveys/<survey_id>/whatif")
def what_if(survey_id):
    """Predict the heatmap if the router stood at (x, y) instead."""
    survey = find_survey(survey_id)
    x, y = point_in_floor(request.args, survey)
    result = mapping.predict_map(survey["width"], survey["height"], readings_on_floor(survey),
                                 survey.get("router"), {"x": x, "y": y})
    if not result.get("ready"):
        raise ApiError(result["message"], 409)
    return jsonify(result)


@app.get("/api/surveys/<survey_id>/export.csv")
def export_csv(survey_id):
    survey = find_survey(survey_id)
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(["x_m", "y_m", "rssi_mean_dbm", "rssi_std_db", "min_dbm", "max_dbm",
                     "n_samples", "band_quality", "ssid", "channel", "wifi_band", "mode", "time"])
    for r in store.list_readings(survey_id):
        writer.writerow([r["x"], r["y"], r["rssi_mean"], r["rssi_std"], r["min"], r["max"],
                         len(r["samples"]), mapping.band_name(r["rssi_mean"]), r.get("ssid") or "",
                         r.get("channel") or "", r.get("band") or "",
                         r.get("mode") or r.get("method") or "", r["time"]])
    safe_name = "".join(ch if ch.isalnum() else "_" for ch in survey["name"]) or "survey"
    return Response(out.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{safe_name}.csv"'})


if __name__ == "__main__":
    sampler.start()                          # background RSSI / ping / scan threads
    # --lan: listen on every network interface so a phone on the same Wi-Fi can
    # open the dashboard. Default: only this laptop (127.0.0.1).
    lan = "--lan" in sys.argv
    host = "0.0.0.0" if lan else "127.0.0.1"
    # debug shows errors - but never on the LAN, where Flask's debugger would be
    # reachable by other devices (errors are still logged in this terminal).
    # use_reloader=False stops Flask starting twice (two samplers, two in-memory
    # stores); threaded=True serves the live stream and normal requests at once.
    app.run(host=host, port=5000, debug=not lan, use_reloader=False, threaded=True)
