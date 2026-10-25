# A Measure / room measurement must come from ONE place: if the user walks to
# another room during the count, or presses Stop, nothing is saved.
import threading
import time

import app as backend
from sampler import MeasurementCancelled, Sampler


def fake_samples(values):
    return [{"rssi": v, "ssid": "TestNet", "channel": 6, "band": "2.4 GHz", "method": "test", "error": None}
            for v in values]


def new_survey(client):
    return client.post("/api/surveys", json={"name": "Home", "width": 10, "height": 8}).get_json()["id"]


def test_walking_into_another_room_is_not_saved(client, monkeypatch):
    sid = new_survey(client)
    walked = fake_samples([-55, -56, -55, -57, -58, -66, -68, -69, -70, -69])    # hall -> bedroom
    monkeypatch.setattr(backend.sampler, "wait_for_samples", lambda n, timeout=None: walked[:n])
    r = client.post(f"/api/surveys/{sid}/rooms/measure", json={"room": "Hall", "samples": 10})
    assert r.status_code == 409
    assert "moved" in r.get_json()["error"]
    assert client.get(f"/api/surveys/{sid}/rooms").get_json()["rooms"] == []

    r = client.post(f"/api/surveys/{sid}/measure", json={"x": 2, "y": 2, "samples": 10})
    assert r.status_code == 409


def test_normal_fluctuation_standing_still_is_saved(client, monkeypatch):
    sid = new_survey(client)
    still = fake_samples([-60, -63, -58, -61, -64, -59, -62, -60, -63, -61])     # ±3 dB fading
    monkeypatch.setattr(backend.sampler, "wait_for_samples", lambda n, timeout=None: still[:n])
    r = client.post(f"/api/surveys/{sid}/rooms/measure", json={"room": "Hall", "samples": 10})
    assert r.status_code == 201


def test_track_mode_is_not_checked(client):
    # walking is the whole point of track mode - only Measure / rooms need stillness
    assert backend.signal_change([-50, -50, -50, -70, -70, -70]) == 20
    assert backend.signal_change([-50, -70, -60]) == 0       # too few samples to judge


def test_stop_cancels_a_running_wait():
    s = Sampler()                       # not started: no samples will ever arrive
    errors = []

    def wait():
        try:
            s.wait_for_samples(10, timeout=20)
        except MeasurementCancelled:
            errors.append("cancelled")

    t = threading.Thread(target=wait)
    t.start()
    time.sleep(0.1)
    started = time.time()
    s.cancel_waits()
    t.join(timeout=2)
    assert errors == ["cancelled"] and time.time() - started < 1


def test_cancel_endpoint(client, monkeypatch):
    sid = new_survey(client)

    def cancelled(n, timeout=None):
        raise MeasurementCancelled()
    monkeypatch.setattr(backend.sampler, "wait_for_samples", cancelled)
    r = client.post(f"/api/surveys/{sid}/rooms/measure", json={"room": "Hall"})
    assert r.status_code == 409 and "stopped" in r.get_json()["error"]
    assert client.post("/api/measure/cancel").get_json() == {"cancelled": True}
