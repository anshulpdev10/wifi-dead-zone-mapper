"""
db.py - storage layer.  app.py only calls the methods below, so it does not
care WHERE data is kept:

  SupabaseStore : real database (Postgres hosted by Supabase), data is permanent.
  MemoryStore   : plain Python dictionaries, used automatically when Supabase
                  is not configured or unreachable. Data is LOST when the
                  server stops, so the dashboard warns you to export CSV.

Both classes have exactly the same methods (same "interface").
"""

import json
import os
import time
import uuid
from datetime import datetime, timezone

# Columns returned for the survey dropdown (the plan image is left out - it is big).
SURVEY_SUMMARY = ("id", "name", "width", "height", "created")
# Reading columns added for the live version (see the "upgrade" part of schema.sql).
NEW_READING_COLUMNS = ("channel", "band", "mode", "room")
# Old tables have no "room" column: a room reading is then saved with
# method = "room:Kitchen" and turned back into room = "Kitchen" when read.
ROOM_PREFIX = "room:"


class SchemaOutdated(Exception):
    """The Supabase tables are older than the code - re-run schema.sql."""


def _now():
    return datetime.now(timezone.utc).isoformat()


def _is_uuid(value):
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


class MemoryStore:
    mode = "memory"

    def __init__(self):
        self.surveys = {}    # id -> survey dict
        self.readings = {}   # id -> reading dict

    # -- surveys
    def list_surveys(self):
        rows = [{k: s[k] for k in SURVEY_SUMMARY} for s in self.surveys.values()]
        return sorted(rows, key=lambda s: s["created"], reverse=True)

    def get_survey(self, survey_id):
        return self.surveys.get(survey_id)

    def create_survey(self, data):
        survey = {"id": str(uuid.uuid4()), "created": _now(), "plan": None, "router": None, "setup": None, **data}
        self.surveys[survey["id"]] = survey
        return survey

    def update_survey(self, survey_id, fields):
        if survey_id not in self.surveys:
            return None
        self.surveys[survey_id].update(fields)
        return self.surveys[survey_id]

    def delete_survey(self, survey_id):
        if self.surveys.pop(survey_id, None) is None:
            return False
        # Same as "on delete cascade" in SQL: remove the survey's readings too.
        for rid in [r["id"] for r in self.readings.values() if r["survey_id"] == survey_id]:
            del self.readings[rid]
        return True

    # -- readings
    def list_readings(self, survey_id):
        rows = [r for r in self.readings.values() if r["survey_id"] == survey_id]
        return sorted(rows, key=lambda r: r["time"])

    def add_reading(self, data):
        reading = {"id": str(uuid.uuid4()), "time": _now(), **data}
        self.readings[reading["id"]] = reading
        return reading

    def delete_reading(self, reading_id):
        return self.readings.pop(reading_id, None) is not None


class LocalSetupFile:
    """survey id -> room directions, saved in backend/local_setup.json.
    Only used while the Supabase 'setup' column is missing (old schema)."""
    PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "local_setup.json")

    def __init__(self):
        try:
            with open(self.PATH, encoding="utf-8") as f:
                self.data = json.load(f)
        except (OSError, ValueError):
            self.data = {}

    def get(self, survey_id):
        return self.data.get(survey_id)

    def set(self, survey_id, setup):
        if setup is None:
            self.data.pop(survey_id, None)
        else:
            self.data[survey_id] = setup
        with open(self.PATH, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2)


class SupabaseStore:
    mode = "supabase"

    def __init__(self, url, key):
        from supabase import create_client   # imported here so memory mode needs no network
        self.client = create_client(url, key)
        # Test query: fails fast if the URL/key is wrong or schema.sql was not run.
        self.client.table("surveys").select("id").limit(1).execute()
        # Newer columns (channel, band, mode). If schema.sql has not been re-run
        # yet, keep working and simply leave them out when saving.
        try:
            self.client.table("readings").select(",".join(NEW_READING_COLUMNS)).limit(1).execute()
            self.missing_columns = False
        except Exception:
            self.missing_columns = True
        try:   # surveys.setup (room directions for the guided survey)
            self.client.table("surveys").select("setup").limit(1).execute()
            self.has_setup = True
        except Exception:
            self.has_setup = False
        # Until schema.sql is re-run, room directions are kept in a small local
        # JSON file instead, so the guided survey still works.
        self.local_setup = LocalSetupFile() if not self.has_setup else None

    def _split_setup(self, data):
        """Without the 'setup' column, take setup out of the row (kept locally)."""
        if self.has_setup or "setup" not in data:
            return data, False, None
        return {k: v for k, v in data.items() if k != "setup"}, True, data["setup"]

    def _with_setup(self, survey):
        if survey is not None and self.local_setup is not None:
            survey = {**survey, "setup": self.local_setup.get(survey["id"])}
        return survey

    def _table(self, name):
        return self.client.table(name)

    def _run(self, query, retry=True):
        """Execute a query and return its rows. If the network connection to
        Supabase drops (Wi-Fi blip, idle connection closed), try once more.
        Inserts pass retry=False so a reading can never be saved twice."""
        import httpx                      # installed together with supabase
        try:
            return query.execute().data
        except httpx.TransportError:
            if not retry:
                raise
            time.sleep(0.3)
            return query.execute().data

    # -- surveys
    def list_surveys(self):
        return self._run(self._table("surveys").select(",".join(SURVEY_SUMMARY))
                         .order("created", desc=True))

    def get_survey(self, survey_id):
        if not _is_uuid(survey_id):          # Postgres would reject a bad uuid
            return None
        rows = self._run(self._table("surveys").select("*").eq("id", survey_id))
        return self._with_setup(rows[0]) if rows else None

    def create_survey(self, data):
        data, has_local, setup = self._split_setup(data)
        survey = self._run(self._table("surveys").insert(data), retry=False)[0]
        if has_local:
            self.local_setup.set(survey["id"], setup)
        return self._with_setup(survey)

    def update_survey(self, survey_id, fields):
        if not _is_uuid(survey_id):
            return None
        fields, has_local, setup = self._split_setup(fields)
        if fields:
            rows = self._run(self._table("surveys").update(fields).eq("id", survey_id))
        else:                                   # only the (local) setup changed
            rows = self._run(self._table("surveys").select("*").eq("id", survey_id))
        if not rows:
            return None
        if has_local:
            self.local_setup.set(survey_id, setup)
        return self._with_setup(rows[0])

    def delete_survey(self, survey_id):
        if not _is_uuid(survey_id):
            return False
        deleted = bool(self._run(self._table("surveys").delete().eq("id", survey_id)))
        if deleted and self.local_setup is not None:
            self.local_setup.set(survey_id, None)
        return deleted

    # -- readings
    def list_readings(self, survey_id):
        if not _is_uuid(survey_id):
            return []
        rows = self._run(self._table("readings").select("*").eq("survey_id", survey_id)
                         .order("time"))
        return [self._from_old(r) for r in rows]

    def _from_old(self, row):
        """Recover a room name kept in "method" (saved while the table was old;
        still works after schema.sql has been re-run)."""
        method = row.get("method") or ""
        if not row.get("room") and method.startswith(ROOM_PREFIX):
            return {**row, "room": method[len(ROOM_PREFIX):], "mode": "room"}
        return row

    def add_reading(self, data):
        if self.missing_columns:
            # Old table: keep at least the mode (measure / walk / manual) in "method",
            # or "room:<name>" for a room reading.
            method = ROOM_PREFIX + data["room"] if data.get("room") else data.get("mode") or data.get("method")
            data = {**{k: v for k, v in data.items() if k not in NEW_READING_COLUMNS}, "method": method}
        return self._from_old(self._run(self._table("readings").insert(data), retry=False)[0])

    def delete_reading(self, reading_id):
        if not _is_uuid(reading_id):
            return False
        return bool(self._run(self._table("readings").delete().eq("id", reading_id)))


def connect():
    """Try Supabase first; fall back to memory. Returns (store, message)."""
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_KEY", "").strip()
    if not url or not key:
        return MemoryStore(), "SUPABASE_URL / SUPABASE_KEY not set in backend/.env - using in-memory storage."
    try:
        store = SupabaseStore(url, key)
        if store.missing_columns or not store.has_setup:
            return store, (f"Connected to Supabase ({url}), but the tables are missing the newest "
                           "columns (channel/band/mode/room, setup) - re-run schema.sql to add them. "
                           "Until then room directions are kept in backend/local_setup.json.")
        return store, f"Connected to Supabase ({url})."
    except Exception as exc:   # bad key, no internet, tables missing...
        return MemoryStore(), f"Supabase unreachable ({exc}) - using in-memory storage."
