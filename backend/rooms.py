"""
rooms.py - room-by-room survey: no floor plan, no metres, no walking plan.

You walk into a room, tell the app its name and it averages the signal there
(you can measure several spots per room). This module turns those readings
into an answer:

  1. Per room   : average / best / worst dBm, number of spots, band, status
                  good (>= -67), fair (-75 .. -67) or dead (< -75)
  2. Verdict    : an extender is needed when at least one room is dead
  3. Extender   : the WEAKEST room that still has GOOD signal. An extender
                  needs a strong signal to repeat, and the weakest good room is
                  the edge of good coverage - the closest a strong spot gets to
                  the dead rooms. (The app cannot know how rooms connect, so the
                  advice also says to pick the spot in that room nearest the
                  dead room.)
  4. Advice     : plain-English tips (unstable rooms, dead spots, more rooms)
  5. Router room: the strongest room (if strong enough) - the router is
                  almost always in it or right next to it
"""

from mapping import DEAD_DBM, GOOD_DBM, band_name

UNSTABLE_STD_DB = 4      # a spot whose samples wobbled more than this is "unstable"
ROUTER_ROOM_DBM = -60    # the strongest room is called "probably the router's room" only if this strong


def _status(avg):
    if avg >= GOOD_DBM:
        return "good"
    if avg >= DEAD_DBM:
        return "fair"
    return "dead"


def group_rooms(readings):
    """Room readings grouped by name (case-insensitive), strongest room first."""
    groups = {}
    for r in readings:
        name = r.get("room")
        if not name:
            continue                       # a floor-map reading, not a room reading
        groups.setdefault(name.casefold(), {"name": name, "readings": []})["readings"].append(r)

    rooms = []
    for g in groups.values():
        values = [r["rssi_mean"] for r in g["readings"]]
        avg = sum(values) / len(values)
        rooms.append({
            "name": g["name"],
            "avg_dbm": round(avg, 1),
            "best_dbm": round(max(values), 1),
            "worst_dbm": round(min(values), 1),
            "spots": len(values),
            "band": band_name(avg),
            "status": _status(avg),
            "unstable": any(r.get("rssi_std", 0) > UNSTABLE_STD_DB for r in g["readings"]),
            "reading_ids": [r["id"] for r in g["readings"]],
        })
    rooms.sort(key=lambda room: room["avg_dbm"], reverse=True)
    return rooms


def _names(rooms):
    return ", ".join(f"{r['name']} ({r['avg_dbm']:g} dBm)" for r in rooms)


def extender_advice(rooms):
    """Where to put an extender (or what to do instead). Returns (room_or_None, text)."""
    dead = [r for r in rooms if r["status"] == "dead"]
    good = [r for r in rooms if r["status"] == "good"]
    fair = [r for r in rooms if r["status"] == "fair"]
    worst = dead[-1] if dead else None
    if not dead:
        return None, None

    if good:
        spot = good[-1]                                   # weakest room that is still good
        if spot is rooms[0] and len(good) == 1:
            # Only the strongest room (most likely where the router is) is good:
            # an extender right next to the router would not help much.
            return spot, (f"Only {spot['name']} has good signal - that is probably where the router is. "
                          f"Put the extender between {spot['name']} and {worst['name']}: measure a room "
                          f"or doorway on the way there; the last spot that still reads -67 dBm or better "
                          f"is the right place.")
        return spot, (f"Put the extender in {spot['name']}. It still gets {spot['avg_dbm']:g} dBm (good) "
                      f"and is the weakest of the good rooms, so it is the closest strong spot to "
                      f"{worst['name']}. Inside {spot['name']}, choose the side nearest {worst['name']}.")
    if fair:
        spot = fair[0]
        return spot, (f"No room has good signal to feed an extender - the best is {spot['name']} "
                      f"({spot['avg_dbm']:g} dBm, fair). An extender there would repeat a weak signal; "
                      f"a mesh Wi-Fi system or a wired access point works better.")
    return None, ("No room has a usable signal to feed an extender. Move the router to a central, open "
                  "spot (not inside a cupboard or behind the TV), or use a mesh system / wired access point.")


def analyse(readings):
    """Main entry point used by app.py: GET /api/surveys/<id>/rooms."""
    rooms = group_rooms(readings)
    if not rooms:
        return {"ready": False, "rooms": [], "extender": None, "advice": [],
                "message": "No rooms measured yet. Walk into a room, pick its name and press Measure."}

    dead = [r for r in rooms if r["status"] == "dead"]
    fair = [r for r in rooms if r["status"] == "fair"]
    spot, where = extender_advice(rooms)

    if dead:
        verdict = {"needed": True,
                   "reason": f"{len(dead)} room(s) in a dead zone (below {DEAD_DBM} dBm): {_names(dead)}."}
    elif fair:
        verdict = {"needed": False,
                   "reason": f"No dead rooms. {_names(fair)} only fair: browsing is fine, video calls may "
                             f"stutter. Moving the router to a more central spot may be enough."}
    else:
        verdict = {"needed": False, "reason": "Every measured room has good signal - no extender needed."}

    advice = []
    if where:
        advice.append(where)
    for r in rooms:
        if r["status"] != "dead" and r["worst_dbm"] < DEAD_DBM:
            advice.append(f"{r['name']} is fine on average, but one spot there reads {r['worst_dbm']:g} dBm "
                          f"- avoid using Wi-Fi from that spot.")
    unstable = [r["name"] for r in rooms if r["unstable"]]
    if unstable:
        advice.append(f"The signal wobbled a lot in {', '.join(unstable)} (people moving, microwave, doors). "
                      f"Measure there again to be sure.")
    if len(rooms) < 3:
        advice.append("Measure every room you use Wi-Fi in - the verdict gets more reliable with each room.")

    # The router is almost always in (or right next to) the strongest room.
    router_room = rooms[0]["name"] if len(rooms) >= 2 and rooms[0]["avg_dbm"] >= ROUTER_ROOM_DBM else None

    return {
        "ready": True,
        "preliminary": len(rooms) < 2,
        "router_room": router_room,
        "rooms": rooms,
        "extender": verdict,
        "extender_room": spot["name"] if spot else None,
        "advice": advice,
        "thresholds": {"good": GOOD_DBM, "dead": DEAD_DBM},
    }
