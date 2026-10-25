"""REST API in memory mode. The background sampler is not started; measure /
walk get fake samples instead of reading the real Wi-Fi adapter."""
import pytest

import app as backend


@pytest.fixture
def client(monkeypatch):
    backend.store.surveys.clear()
    backend.store.readings.clear()
    fake = [{"rssi": v, "ssid": "TestNet", "channel": 6, "band": "2.4 GHz", "method": "test", "error": None}
            for v in (-60, -62, -61, -63, -59, -60, -61, -62, -60, -61)]
    monkeypatch.setattr(backend.sampler, "wait_for_samples", lambda n, timeout=None: fake[:n])
    return backend.app.test_client()


def make_survey(client, **extra):
    res = client.post("/api/surveys", json={"name": "Test floor", "width": 12, "height": 8, **extra})
    assert res.status_code == 201
    return res.get_json()


def test_health_reports_memory_mode(client):
    assert client.get("/api/health").get_json()["db"] == "memory"


def test_create_validates_fields(client):
    assert client.post("/api/surveys", json={"name": "", "width": 12, "height": 8}).status_code == 400
    assert client.post("/api/surveys", json={"name": "x", "width": 500, "height": 8}).status_code == 400
    assert client.post("/api/surveys", json={"name": "x", "width": 12, "height": 8, "plan": "nope"}).status_code == 400
    assert "error" in client.post("/api/surveys", json=[1]).get_json()


def test_measure_walk_and_manual_readings(client):
    sid = make_survey(client)["id"]
    m = client.post(f"/api/surveys/{sid}/measure", json={"x": 3, "y": 2, "samples": 10}).get_json()
    assert m["mode"] == "measure" and len(m["samples"]) == 10 and m["ssid"] == "TestNet"
    w = client.post(f"/api/surveys/{sid}/walk", json={"x": 6, "y": 2}).get_json()
    assert w["mode"] == "walk" and len(w["samples"]) == 3
    man = client.post(f"/api/surveys/{sid}/readings", json={"x": 9, "y": 6, "rssi": -80})
    assert man.status_code == 201
    assert client.post(f"/api/surveys/{sid}/readings", json={"x": 99, "y": 6, "rssi": -80}).status_code == 400
    assert client.post(f"/api/surveys/{sid}/readings", json={"x": 1, "y": 1, "rssi": 5}).status_code == 400
    assert len(client.get(f"/api/surveys/{sid}/readings").get_json()) == 3


def test_map_calibration_whatif_and_export(client):
    sid = make_survey(client)["id"]
    client.patch(f"/api/surveys/{sid}", json={"router": {"x": 1, "y": 1}})
    for x, y, rssi in [(2, 1, -45), (4, 2, -55), (6, 4, -62), (8, 6, -70), (10, 7, -82), (11, 2, -78)]:
        client.post(f"/api/surveys/{sid}/readings", json={"x": x, "y": y, "rssi": rssi})

    m = client.get(f"/api/surveys/{sid}/map").get_json()
    assert m["ready"] and not m["partial"] and m["stats"]["readings"] == 6
    cal = client.get(f"/api/surveys/{sid}/calibration").get_json()
    assert cal["ready"] and cal["n"] > 0
    w = client.get(f"/api/surveys/{sid}/whatif?x=8&y=5")
    assert w.status_code == 200 and w.get_json()["prediction"]
    assert client.get(f"/api/surveys/{sid}/whatif?x=99&y=5").status_code == 400

    csv = client.get(f"/api/surveys/{sid}/export.csv")
    assert csv.status_code == 200 and csv.mimetype == "text/csv"
    assert len(csv.get_data(as_text=True).strip().splitlines()) == 7     # header + 6


def test_setup_router_and_delete(client):
    sid = make_survey(client)["id"]
    s = client.patch(f"/api/surveys/{sid}", json={"setup": {"corner": "door corner", "wall": "window wall",
                                                            "step_m": 0.75}}).get_json()
    assert s["setup"]["corner"] == "door corner"
    assert client.patch(f"/api/surveys/{sid}", json={"setup": {"corner": ""}}).status_code == 400
    assert client.patch(f"/api/surveys/{sid}", json={"router": {"x": 50, "y": 1}}).status_code == 400
    assert client.patch(f"/api/surveys/{sid}", json={}).status_code == 400

    rid = client.post(f"/api/surveys/{sid}/readings", json={"x": 1, "y": 1, "rssi": -60}).get_json()["id"]
    assert client.delete(f"/api/readings/{rid}").status_code == 200
    assert client.delete(f"/api/readings/{rid}").status_code == 404
    assert client.delete(f"/api/surveys/{sid}").status_code == 200
    assert client.get(f"/api/surveys/{sid}").status_code == 404


def test_shrunk_survey_ignores_points_outside(client):
    sid = make_survey(client)["id"]
    for x in (1, 3, 5, 11):
        client.post(f"/api/surveys/{sid}/readings", json={"x": x, "y": 1, "rssi": -60})
    client.patch(f"/api/surveys/{sid}", json={"width": 6})
    assert client.get(f"/api/surveys/{sid}/map").get_json()["stats"]["readings"] == 3


def test_unknown_routes_return_json(client):
    res = client.get("/api/nope")
    assert res.status_code == 404 and res.get_json()["error"]
