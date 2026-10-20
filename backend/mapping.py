"""
mapping.py - turns a handful of measured points into a full coverage map.

Steps
  1. IDW interpolation : estimate RSSI in every grid cell (default 0.25 m)
                         from the measured points, weight = 1 / distance^2.
  2. Dead-zone regions : group neighbouring cells below -75 dBm with a BFS
                         flood fill, drop tiny ones (< 0.5 m^2).
  3. Extender spot     : the good cell (>= -67 dBm) closest to the centre of
                         the biggest dead region - an extender there still
                         gets a strong signal but sits as near the gap as possible.
  4. Statistics        : % healthy / marginal / dead, dead area, avg/best/worst.
  5. Calibration       : least-squares fit of the log-distance path-loss model
                         RSSI = A - 10 * n * log10(d) to this building (numpy).
  6. What-if           : predicted heatmap if the router moved (model + residuals).

Steps 1-4 are plain Python so every line can be explained; numpy is only
used for the least-squares fit.
"""

import math
from collections import deque

import numpy as np

GOOD_DBM = -67        # >= -67 dBm : healthy (fine for video calls / streaming)
DEAD_DBM = -75        # <  -75 dBm : dead zone (drops, very slow)
MIN_REGION_M2 = 0.5   # ignore dead regions smaller than this
MIN_READINGS = 3      # need at least 3 points for dead zones / extender / stats
IDW_POWER = 2         # weights are 1 / d^2

# Colour bands used by the dashboard (lower bound in dBm, name).
BANDS = [(-50, "Excellent"), (-67, "Good"), (-75, "Fair"), (-85, "Weak")]


def band_name(rssi):
    """Return the band label for an RSSI value."""
    for lower, name in BANDS:
        if rssi >= lower:
            return name
    return "Dead zone"


# ------------------------------------------------------------ 1. interpolation
def idw(x, y, points):
    """Inverse Distance Weighting at (x, y).
    points = list of (px, py, rssi).  Nearer points count more:
        value = sum(w_i * rssi_i) / sum(w_i),   w_i = 1 / d_i^2"""
    num = den = 0.0
    for px, py, value in points:
        d = math.hypot(x - px, y - py)
        if d < 1e-6:              # standing exactly on a measured point
            return value
        w = 1.0 / d ** IDW_POWER
        num += w * value
        den += w
    return num / den


def build_grid(width, height, points, cell=0.25):
    """Fill a rows x cols grid; each cell holds the IDW estimate at its centre."""
    cols = max(1, math.ceil(width / cell))
    rows = max(1, math.ceil(height / cell))
    grid = []
    for r in range(rows):
        cy = min((r + 0.5) * cell, height)
        grid.append([idw(min((c + 0.5) * cell, width), cy, points) for c in range(cols)])
    return grid


# ---------------------------------------------------------- 2. dead-zone regions
def find_dead_regions(grid, cell):
    """Breadth-first flood fill over cells below DEAD_DBM (4-neighbours)."""
    rows, cols = len(grid), len(grid[0])
    seen = [[False] * cols for _ in range(rows)]
    regions = []

    for r0 in range(rows):
        for c0 in range(cols):
            if seen[r0][c0] or grid[r0][c0] >= DEAD_DBM:
                continue
            # New region: explore every connected dead cell from (r0, c0).
            queue = deque([(r0, c0)])
            seen[r0][c0] = True
            cells = []
            while queue:
                r, c = queue.popleft()
                cells.append((r, c))
                for nr, nc in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
                    if 0 <= nr < rows and 0 <= nc < cols and not seen[nr][nc] \
                            and grid[nr][nc] < DEAD_DBM:
                        seen[nr][nc] = True
                        queue.append((nr, nc))

            area = len(cells) * cell * cell
            if area < MIN_REGION_M2:
                continue
            regions.append({
                "area_m2": round(area, 2),
                "center": {
                    "x": round(sum((c + 0.5) * cell for _, c in cells) / len(cells), 2),
                    "y": round(sum((r + 0.5) * cell for r, _ in cells) / len(cells), 2),
                },
                "worst_dbm": round(min(grid[r][c] for r, c in cells), 1),
                "cells": len(cells),
            })

    regions.sort(key=lambda reg: reg["area_m2"], reverse=True)   # largest first
    return regions


# ---------------------------------------------------------- 3. extender spot
def suggest_extender(grid, cell, regions):
    """Good cell (>= GOOD_DBM) nearest to the centre of the largest dead region."""
    if not regions:
        return None
    target = regions[0]["center"]
    best = None
    for r, row in enumerate(grid):
        for c, value in enumerate(row):
            if value < GOOD_DBM:
                continue
            x, y = (c + 0.5) * cell, (r + 0.5) * cell
            d = math.hypot(x - target["x"], y - target["y"])
            if best is None or d < best["distance_m"]:
                best = {"x": round(x, 2), "y": round(y, 2), "rssi": round(value, 1),
                        "distance_m": round(d, 2)}
    return best


# ---------------------------------------------------------- 4. statistics
def coverage_stats(grid, cell, readings_rssi, regions):
    values = [v for row in grid for v in row]
    total = len(values)
    healthy = sum(v >= GOOD_DBM for v in values)
    dead = sum(v < DEAD_DBM for v in values)
    return {
        "healthy_pct": round(100 * healthy / total, 1),
        "marginal_pct": round(100 * (total - healthy - dead) / total, 1),
        "dead_pct": round(100 * dead / total, 1),
        "dead_area_m2": round(sum(reg["area_m2"] for reg in regions), 2),
        "avg_dbm": round(sum(readings_rssi) / len(readings_rssi), 1),
        "best_dbm": round(max(readings_rssi), 1),
        "worst_dbm": round(min(readings_rssi), 1),
        "readings": len(readings_rssi),
    }


def advice(stats, regions, suggestion):
    """Plain-English recommendations shown in the dashboard."""
    tips = []
    if stats["dead_pct"] == 0 and stats["marginal_pct"] < 10:
        tips.append("Coverage is healthy across the whole floor - no extender needed.")
    if regions:
        big = regions[0]
        tips.append(f"Largest dead zone: {big['area_m2']} m² around "
                    f"({big['center']['x']}, {big['center']['y']}) m, worst {big['worst_dbm']} dBm.")
    if suggestion:
        tips.append(f"Place an extender near ({suggestion['x']}, {suggestion['y']}) m - "
                    f"it still gets {suggestion['rssi']} dBm there and is "
                    f"{suggestion['distance_m']} m from the dead zone centre.")
    elif regions:
        tips.append("No spot reaches -67 dBm to feed an extender - move the router "
                    "closer to the centre of the floor or use a wired access point.")
    if stats["marginal_pct"] >= 25:
        tips.append("A quarter or more of the floor is only 'fair' - avoid placing the "
                    "router inside cabinets or behind thick walls.")
    if stats["readings"] < 8:
        tips.append("Take more readings (8+ spread across the floor) for a more reliable map.")
    return tips


def extender_verdict(stats, regions, suggestion):
    """Clear yes/no answer: is a Wi-Fi extender required?
    Yes when there is at least one dead region (>= 0.5 m^2 below -75 dBm)."""
    if not regions:
        if stats["marginal_pct"] >= 25:
            return {"needed": False,
                    "reason": "No dead zones, but parts of the floor are only 'fair'. "
                              "Moving the router to a more central, open spot may be enough."}
        return {"needed": False, "reason": "No dead zones found - the router covers this floor."}
    # (the dashboard shows the suggested spot itself, in metres from the walls)
    extra = "" if suggestion else (" No spot is strong enough (>= -67 dBm) to feed one - move "
                                   "the router or use a wired access point / mesh node instead.")
    return {"needed": True,
            "reason": f"{len(regions)} dead zone(s), {stats['dead_area_m2']} m² in total.{extra}"}


def compute_map(width, height, readings, cell=0.25):
    """Main entry point used by app.py.
    readings = list of dicts with x, y, rssi_mean.

    0 readings      -> nothing to draw yet
    1-2 readings    -> preliminary heatmap only (partial=True), so the map starts
                       building from the very first point
    3+ readings     -> full analysis: dead zones, extender, statistics"""
    if not readings:
        return {"ready": False, "message": "No readings yet - mark your position and measure."}

    points = [(r["x"], r["y"], r["rssi_mean"]) for r in readings]
    grid = build_grid(width, height, points, cell)
    grid_info = {"cell": cell, "rows": len(grid), "cols": len(grid[0]),
                 "values": [[round(v, 1) for v in row] for row in grid]}

    if len(readings) < MIN_READINGS:
        return {"ready": True, "partial": True, "grid": grid_info,
                "thresholds": {"good": GOOD_DBM, "dead": DEAD_DBM},
                "regions": [], "suggestion": None, "stats": None, "advice": [], "extender": None,
                "message": f"Preliminary heatmap from {len(readings)} reading(s). "
                           f"Take at least {MIN_READINGS} to find dead zones and an extender spot."}
    regions = find_dead_regions(grid, cell)
    suggestion = suggest_extender(grid, cell, regions)
    stats = coverage_stats(grid, cell, [p[2] for p in points], regions)
    return {
        "ready": True,
        "partial": False,
        "grid": grid_info,
        "thresholds": {"good": GOOD_DBM, "dead": DEAD_DBM},
        "regions": regions,
        "suggestion": suggestion,
        "stats": stats,
        "advice": advice(stats, regions, suggestion),
        "extender": extender_verdict(stats, regions, suggestion),
    }
    

# ================================================================ 5. calibration
CAL_MIN_DIST = 0.5        # readings closer than this to the router are not used
CAL_MIN_READINGS = 5
OBSTRUCTED_DB = -8        # residual below this -> "obstructed" (wall / furniture in the way)


def _distance(reading, router):
    return math.hypot(reading["x"] - router["x"], reading["y"] - router["y"])


def calibrate(readings, router):
    """Fit the log-distance path-loss model to this survey's own readings.

        RSSI(d) = A - 10 * n * log10(d)
          A = RSSI at 1 m from the router (dBm)
          n = path-loss exponent: 2 in free space, ~2.7-3.5 in homes/offices,
              higher when walls and furniture absorb more signal.

    With x = -10 * log10(d) this is a straight line  RSSI = A + n * x,
    so ordinary least squares (numpy.linalg.lstsq) finds the A and n that
    minimise the sum of squared errors. R^2 says how well the line fits
    (1 = perfect, 0 = no better than the average).
    The residual of a reading = measured - predicted. A reading 8 dB or more
    BELOW the model has something in the way -> flagged "obstructed"."""
    if not router:
        return {"ready": False, "message": "Place the router on the map to calibrate the path-loss model."}
    usable = [r for r in readings if _distance(r, router) >= CAL_MIN_DIST]
    if len(usable) < CAL_MIN_READINGS:
        return {"ready": False,
                "message": f"Need at least {CAL_MIN_READINGS} readings 0.5 m or more from the router "
                           f"(have {len(usable)})."}

    d = np.array([_distance(r, router) for r in usable])
    rssi = np.array([r["rssi_mean"] for r in usable])
    x = -10 * np.log10(d)
    if np.ptp(x) < 1:          # all readings at almost the same distance -> slope undefined
        return {"ready": False, "message": "Take readings at different distances from the router "
                                           "(near and far) to calibrate."}

    design = np.column_stack([np.ones_like(x), x])          # columns: [1, x]
    (a, n), *_ = np.linalg.lstsq(design, rssi, rcond=None)
    predicted = a + n * x
    residuals = rssi - predicted
    ss_res = float(np.sum(residuals ** 2))
    ss_tot = float(np.sum((rssi - rssi.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else None

    curve_d = np.geomspace(max(CAL_MIN_DIST, d.min()), d.max(), 30)   # for drawing the line
    points = [{"id": r.get("id"), "x": r["x"], "y": r["y"], "distance_m": round(float(di), 2),
               "rssi": round(float(ri), 1), "predicted": round(float(pi), 1),
               "residual": round(float(res), 1), "obstructed": bool(res < OBSTRUCTED_DB)}
              for r, di, ri, pi, res in zip(usable, d, rssi, predicted, residuals)]
    n, a = float(n), float(a)
    return {
        "ready": True,
        "A": round(a, 1), "n": round(n, 2), "r2": round(r2, 3) if r2 is not None else None,
        "points": points,
        "curve": [{"distance_m": round(float(di), 2), "rssi": round(a - 10 * n * math.log10(di), 1)}
                  for di in curve_d],
        "obstructed": sum(p["obstructed"] for p in points),
        "summary": f"This building's path-loss exponent is {n:.1f} (free space = 2). "
                   f"Signal at 1 m from the router: {a:.0f} dBm.",
    }


# ================================================================ 6. what-if
def predict_map(width, height, readings, router, new_router, cell=0.25):
    """Predict the coverage if the router moved to new_router.

    prediction(cell) = model(distance to NEW router)      <- calibrated A and n
                     + IDW of the residuals of the readings
    The residuals carry what the plain model misses (walls, furniture), on the
    assumption that those obstacles stay where they are. It is an estimate:
    a wall's effect really depends on where the router is."""
    cal = calibrate(readings, router)
    if not cal["ready"]:
        return {"ready": False, "message": "What-if needs a calibrated model: " + cal["message"]}

    a, n = cal["A"], cal["n"]

    def model(x, y, rtr):
        return a - 10 * n * math.log10(max(math.hypot(x - rtr["x"], y - rtr["y"]), CAL_MIN_DIST))

    residual_points = [(r["x"], r["y"], r["rssi_mean"] - model(r["x"], r["y"], router)) for r in readings]
    residual_grid = build_grid(width, height, residual_points, cell)
    grid = [[model(min((c + 0.5) * cell, width), min((r + 0.5) * cell, height), new_router) + res
             for c, res in enumerate(row)] for r, row in enumerate(residual_grid)]

    regions = find_dead_regions(grid, cell)
    suggestion = suggest_extender(grid, cell, regions)
    at_readings = [model(r["x"], r["y"], new_router) + res for r, (_, _, res) in zip(readings, residual_points)]
    stats = coverage_stats(grid, cell, at_readings, regions)
    return {
        "ready": True, "partial": False, "prediction": True, "router": new_router,
        "grid": {"cell": cell, "rows": len(grid), "cols": len(grid[0]),
                 "values": [[round(v, 1) for v in row] for row in grid]},
        "regions": regions, "suggestion": suggestion, "stats": stats,
        "extender": extender_verdict(stats, regions, suggestion),
        "advice": [], "model": {"A": a, "n": n},
    }
