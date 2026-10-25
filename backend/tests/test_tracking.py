"""Track mode, the router-position estimate, and the router's room."""
import math
import random
import time

import app as backend
import mapping
import rooms


def simulated(router, count=14, seed=1, noise=1.5):
    rng = random.Random(seed)
    out = []
    for i in range(count):
        x, y = rng.uniform(0.3, 11.7), rng.uniform(0.3, 7.7)
        d = max(math.hypot(x - router[0], y - router[1]), 1)
        out.append({"id": str(i), "x": x, "y": y, "rssi_mean": -38 - 30 * math.log10(d) + rng.gauss(0, noise)})
    return out


def test_router_estimate_finds_router():
    for router in [(2, 3), (7, 5), (10, 2)]:
        est = mapping.estimate_router(12, 8, simulated(router))
        assert math.hypot(est["x"] - router[0], est["y"] - router[1]) < 1.0
        assert est["accuracy_m"] >= 1.0


def test_router_estimate_needs_useful_data():
    assert mapping.estimate_router(12, 8, simulated((2, 3))[:3]) is None
    flat = [{"x": i, "y": 1, "rssi_mean": -60} for i in range(6)]
    assert mapping.estimate_router(12, 8, flat) is None


def test_map_includes_router_estimate():
    result = mapping.compute_map(12, 8, simulated((3, 4)))
    assert result["router_estimate"] is not None


def test_router_room_is_strongest_room():
    r = [{"id": "1", "room": "Bedroom", "rssi_mean": -45, "rssi_std": 1},
         {"id": "2", "room": "Kitchen", "rssi_mean": -70, "rssi_std": 1}]
    assert rooms.analyse(r)["router_room"] == "Bedroom"
    assert rooms.analyse(r[:1])["router_room"] is None                 # one room: can't tell


def test_track_saves_latest_sample(client, monkeypatch):
    sid = client.post("/api/surveys", json={"name": "T", "width": 10, "height": 10}).get_json()["id"]
    sample = {"rssi": -63.0, "ssid": "TestNet", "channel": 6, "band": "2.4 GHz", "method": "test",
              "error": None, "time": time.time()}
    monkeypatch.setattr(backend.sampler, "latest", lambda: sample)
    r = client.post(f"/api/surveys/{sid}/track", json={"x": 4, "y": 5})
    assert r.status_code == 201
    saved = r.get_json()
    assert saved["mode"] == "track" and saved["rssi_mean"] == -63.0 and saved["samples"] == [-63.0]

    sample["time"] = time.time() - 60                                  # stale sample -> refused
    assert client.post(f"/api/surveys/{sid}/track", json={"x": 4, "y": 5}).status_code == 503
    assert client.post(f"/api/surveys/{sid}/track", json={"x": 40, "y": 5}).status_code == 400
