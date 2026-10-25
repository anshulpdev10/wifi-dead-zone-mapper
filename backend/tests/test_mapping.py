"""Heatmap, dead zones, extender spot, calibration and what-if on synthetic data."""
import math

import mapping

ROUTER = {"x": 2, "y": 3}


def model(x, y, n=3.0, a=-40.0, wall_x=8, wall_db=12):
    """Log-distance path loss, plus a wall at x >= wall_x."""
    d = max(math.hypot(x - ROUTER["x"], y - ROUTER["y"]), 1)
    return a - 10 * n * math.log10(d) - (wall_db if x >= wall_x else 0)


def guided_readings(width=12, height=8, **kw):
    """The 10 guided points (5 x 2 grid) with model values."""
    out = []
    for r in range(2):
        for c in range(5):
            x, y = (c + 0.5) / 5 * width, (r + 0.5) / 2 * height
            out.append({"id": f"{r}{c}", "x": x, "y": y, "rssi_mean": model(x, y, **kw)})
    return out


def test_band_names():
    assert mapping.band_name(-45) == "Excellent"
    assert mapping.band_name(-67) == "Good"
    assert mapping.band_name(-70) == "Fair"
    assert mapping.band_name(-80) == "Weak"
    assert mapping.band_name(-90) == "Dead zone"


def test_idw_exact_point_and_average():
    pts = [(0, 0, -50), (2, 0, -70)]
    assert mapping.idw(0, 0, pts) == -50
    assert math.isclose(mapping.idw(1, 0, pts), -60)


def test_no_readings():
    assert mapping.compute_map(12, 8, [])["ready"] is False


def test_single_reading_does_not_paint_whole_floor():
    result = mapping.compute_map(12, 8, [{"x": 2, "y": 3, "rssi_mean": -50}])
    assert result["partial"] is True
    values = [v for row in result["grid"]["values"] for v in row]
    assert any(v is None for v in values)          # far corners: not measured
    assert any(v == -50 for v in values)           # around the reading: coloured


def test_guided_survey_covers_floor_and_finds_dead_zone():
    result = mapping.compute_map(12, 8, guided_readings())
    stats = result["stats"]
    assert stats["measured_pct"] == 100.0
    assert stats["dead_pct"] > 0
    assert result["regions"], "the area behind the wall should be a dead zone"
    assert result["extender"]["needed"] is True
    spot = result["suggestion"]
    assert spot and spot["rssi"] >= mapping.GOOD_DBM
    assert 0 <= spot["x"] <= 12 and 0 <= spot["y"] <= 8
    assert abs(stats["healthy_pct"] + stats["marginal_pct"] + stats["dead_pct"] - 100) < 0.5


def test_strong_everywhere_needs_no_extender():
    readings = [{"x": x, "y": y, "rssi_mean": -50} for x in (2, 6, 10) for y in (2, 6)]
    result = mapping.compute_map(12, 8, readings)
    assert result["regions"] == []
    assert result["extender"]["needed"] is False


def test_unmeasured_cells_are_never_dead():
    grid = [[None, -90], [None, -90]]
    regions = mapping.find_dead_regions(grid, 1.0)
    assert len(regions) == 1 and regions[0]["cells"] == 2


def test_big_floor_uses_coarser_cells():
    result = mapping.compute_map(200, 150, [{"x": 10, "y": 10, "rssi_mean": -60}] * 3)
    assert result["grid"]["cols"] <= mapping.MAX_CELLS_SIDE + 1


def test_calibration_recovers_path_loss_exponent():
    readings = guided_readings(wall_db=0)               # pure model, no wall
    cal = mapping.calibrate(readings, ROUTER)
    assert cal["ready"]
    assert abs(cal["n"] - 3.0) < 0.2
    assert abs(cal["A"] - -40) < 2
    assert cal["r2"] > 0.95


def test_calibration_needs_router_and_enough_points():
    assert mapping.calibrate(guided_readings(), None)["ready"] is False
    assert mapping.calibrate(guided_readings()[:3], ROUTER)["ready"] is False


def test_whatif_moving_router_towards_dead_zone_helps():
    readings = guided_readings()
    now = mapping.compute_map(12, 8, readings)["stats"]
    moved = mapping.predict_map(12, 8, readings, ROUTER, {"x": 8, "y": 4})
    assert moved["ready"] and moved["prediction"]
    assert moved["stats"]["dead_pct"] < now["dead_pct"]
