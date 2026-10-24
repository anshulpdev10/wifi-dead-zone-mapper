"""
db.py - storage layer.  app.py only calls the methods below, so it does not
care WHERE data is kept:

  SupabaseStore : real database (Postgres hosted by Supabase), data is permanent.
  MemoryStore   : plain Python dictionaries, used automatically when Supabase
                  is not configured or unreachable. Data is LOST when the
                  server stops, so the dashboard warns you to export CSV.

Both classes have exactly the same methods (same "interface").
"""

import os
import time
import uuid
from datetime import datetime, timezone

# Columns returned for the survey dropdown (the plan image is left out - it is big).
SURVEY_SUMMARY = ("id", "name", "width", "height", "created")
# Reading columns added for the live version (see the "upgrade" part of schema.sql).
NEW_READING_COLUMNS = ("channel", "band", "mode")


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

    def _check_setup(self, data):
        if "setup" in data and not self.has_setup:
            raise SchemaOutdated("Saving room directions needs the new 'setup' column - "
                                 "re-run backend/schema.sql in the Supabase SQL Editor.")

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
        return rows[0] if rows else None

    def create_survey(self, data):
        if not self.has_setup and data.get("setup") is None:
            data = {k: v for k, v in data.items() if k != "setup"}
        self._check_setup(data)
        return self._run(self._table("surveys").insert(data), retry=False)[0]

    def update_survey(self, survey_id, fields):
        if not _is_uuid(survey_id):
            return None
        self._check_setup(fields)
        rows = self._run(self._table("surveys").update(fields).eq("id", survey_id))
        return rows[0] if rows else None

    def delete_survey(self, survey_id):
        if not _is_uuid(survey_id):
            return False
        return bool(self._run(self._table("surveys").delete().eq("id", survey_id)))

    # -- readings
    def list_readings(self, survey_id):
        if not _is_uuid(survey_id):
            return []
        return self._run(self._table("readings").select("*").eq("survey_id", survey_id)
                         .order("time"))

    def add_reading(self, data):
        if self.missing_columns:
            # Old table: keep at least the mode (measure / walk / manual) in "method".
            data = {**{k: v for k, v in data.items() if k not in NEW_READING_COLUMNS},
                    "method": data.get("mode") or data.get("method")}
        return self._run(self._table("readings").insert(data), retry=False)[0]

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
                           "columns (channel/band/mode, setup) - re-run schema.sql to add them.")
        return store, f"Connected to Supabase ({url})."
    except Exception as exc:   # bad key, no internet, tables missing...
        return MemoryStore(), f"Supabase unreachable ({exc}) - using in-memory storage."
