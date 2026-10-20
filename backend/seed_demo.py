"""
seed_demo.py - TESTING ONLY. Fills the running API with SIMULATED readings so
the map can be checked without walking around.

Uses the log-distance path-loss model:
    RSSI(d) = P0 - 10 * n * log10(d / d0) - wall losses
    P0 = -40 dBm at d0 = 1 m, path-loss exponent n = 3 (indoor)
    router at (2, 3) m on a 12 x 8 m floor
    wall at x >= 6 m  : extra -7 dB
    wall at x >= 10 m : extra -10 dB (so -17 dB total behind both walls)

Usage (with app.py running):   python seed_demo.py
"""

import json
import math
import random
import urllib.request

API = "http://127.0.0.1:5000/api"
NAME = "Demo (simulated)"
WIDTH, HEIGHT = 12, 8
ROUTER = (2, 3)


def call(method, path, data=None):
    """Tiny JSON HTTP helper using only the standard library."""
    req = urllib.request.Request(API + path, method=method,
                                 data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def model_rssi(x, y):
    d = max(math.hypot(x - ROUTER[0], y - ROUTER[1]), 1.0)   # model is valid from 1 m
    rssi = -40 - 10 * 3 * math.log10(d)
    if x >= 6:
        rssi -= 7
    if x >= 10:
        rssi -= 10
    return rssi


def main():
    random.seed(42)   # same "random" noise every run
    # Remove an old demo so the script can be re-run safely.
    for s in call("GET", "/surveys"):
        if s["name"] == NAME:
            call("DELETE", f"/surveys/{s['id']}")

    survey = call("POST", "/surveys", {"name": NAME, "width": WIDTH, "height": HEIGHT})
    call("PATCH", f"/surveys/{survey['id']}", {"router": {"x": ROUTER[0], "y": ROUTER[1]}})

    count = 0
    for i in range(8):                 # x = 0.5 .. 11.0 m
        for j in range(6):             # y = 0.5 .. 7.5 m
            x, y = round(0.5 + i * 1.5, 2), round(0.5 + j * 1.4, 2)
            rssi = round(max(-110, model_rssi(x, y) + random.gauss(0, 1.5)), 1)
            call("POST", f"/surveys/{survey['id']}/readings", {"x": x, "y": y, "rssi": rssi})
            count += 1

    print(f"Created '{NAME}' ({survey['id']}) with {count} simulated readings.")


if __name__ == "__main__":
    main()
