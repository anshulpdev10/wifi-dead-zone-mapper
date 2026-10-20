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

Plain Python only (no numpy) so every line can be explained.
"""

import math
from collections import deque

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
        tips.append(f"Largest dead zone: {big['area_m2']} m^2 around "
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
                "regions": [], "suggestion": None, "stats": None, "advice": [],
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
    }
