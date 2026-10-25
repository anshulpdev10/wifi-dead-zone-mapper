"""Room-by-room survey: grouping, verdict, extender room, API endpoints."""
import rooms


def reading(room, rssi, std=1.0, rid=None):
    return {"id": rid or f"{room}{rssi}", "room": room, "x": 0, "y": 0, "rssi_mean": rssi, "rssi_std": std}


def test_no_rooms_yet():
    result = rooms.analyse([{"id": "a", "x": 1, "y": 1, "rssi_mean": -50, "rssi_std": 1}])   # floor-map only
    assert result["ready"] is False and result["rooms"] == []


def test_groups_case_insensitive_and_ranks():
    result = rooms.analyse([reading("Kitchen", -70), reading("kitchen", -74, rid="k2"),
                            reading("Bedroom", -48), reading("Balcony", -81)])
    names = [r["name"] for r in result["rooms"]]
    assert names == ["Bedroom", "Kitchen", "Balcony"]
    kitchen = result["rooms"][1]
    assert kitchen["spots"] == 2 and kitchen["avg_dbm"] == -72 and kitchen["status"] == "fair"


def test_dead_room_needs_extender_in_weakest_good_room():
    result = rooms.analyse([reading("Bedroom", -45), reading("Hall", -60), reading("Kitchen", -72),
                            reading("Balcony", -82)])
    assert result["extender"]["needed"] is True
    assert "Balcony" in result["extender"]["reason"]
    assert result["extender_room"] == "Hall"          # weakest room that is still good


def test_only_router_room_good_says_in_between():
    result = rooms.analyse([reading("Bedroom", -45), reading("Balcony", -82)])
    assert result["extender_room"] == "Bedroom"
    assert "between" in result["advice"][0]


def test_no_good_room_recommends_mesh():
    result = rooms.analyse([reading("Hall", -70), reading("Balcony", -82)])
    assert result["extender"]["needed"] is True
    assert "mesh" in result["advice"][0]


def test_all_good_no_extender():
    result = rooms.analyse([reading("Bedroom", -45), reading("Hall", -55), reading("Kitchen", -60)])
    assert result["extender"]["needed"] is False and result["extender_room"] is None


def test_unstable_and_dead_spot_advice():
    result = rooms.analyse([reading("Hall", -50, std=6), reading("Hall", -80, rid="h2"), reading("Bed", -55),
                            reading("Desk", -58)])
    text = " ".join(result["advice"])
    assert "wobbled" in text and "one spot" in text


def test_old_supabase_table_keeps_room_in_method():
    import db
    store = object.__new__(db.SupabaseStore)          # no network: only the conversion logic
    store.missing_columns = True
    sent = {}
    store._table = lambda name: type("T", (), {"insert": lambda self, data: sent.update(data) or data})()
    store._run = lambda query, retry=True: [dict(sent, id="r1")]
    saved = store.add_reading({"survey_id": "s", "x": 0, "y": 0, "rssi_mean": -70, "mode": "room",
                               "room": "Kitchen", "channel": 6, "band": "2.4 GHz"})
    assert sent["method"] == "room:Kitchen" and "room" not in sent and "channel" not in sent
    assert saved["room"] == "Kitchen" and saved["mode"] == "room"


def test_room_api(client):
    sid = client.post("/api/surveys", json={"name": "Home", "width": 12, "height": 8}).get_json()["id"]
    assert client.post(f"/api/surveys/{sid}/rooms/measure", json={"room": "  "}).status_code == 400
    r = client.post(f"/api/surveys/{sid}/rooms/measure", json={"room": "  Living   room ", "samples": 5})
    assert r.status_code == 201
    saved = r.get_json()
    assert saved["room"] == "Living room" and saved["mode"] == "room" and len(saved["samples"]) == 5

    # a floor-map reading in the same survey is not a room, and room readings are not on the map
    client.post(f"/api/surveys/{sid}/readings", json={"x": 2, "y": 2, "rssi": -50})
    result = client.get(f"/api/surveys/{sid}/rooms").get_json()
    assert [room["name"] for room in result["rooms"]] == ["Living room"]
    assert client.get(f"/api/surveys/{sid}/map").get_json()["grid"]["values"][8][8] == -50

    csv = client.get(f"/api/surveys/{sid}/export.csv").get_data(as_text=True)
    assert "Living room" in csv

    assert client.delete(f"/api/surveys/{sid}/rooms/living%20room").get_json()["deleted"] == 1
    assert client.get(f"/api/surveys/{sid}/rooms").get_json()["ready"] is False
    assert client.delete(f"/api/surveys/{sid}/rooms/Nowhere").status_code == 404
