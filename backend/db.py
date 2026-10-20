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
import uuid
from datetime import datetime, timezone

# Columns returned for the survey dropdown (the plan image is left out - it is big).
SURVEY_SUMMARY = ("id", "name", "width", "height", "created")


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
        survey = {"id": str(uuid.uuid4()), "created": _now(), "plan": None, "router": None, **data}
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

    def _table(self, name):
        return self.client.table(name)

    # -- surveys
    def list_surveys(self):
        return self._table("surveys").select(",".join(SURVEY_SUMMARY)) \
            .order("created", desc=True).execute().data

    def get_survey(self, survey_id):
        if not _is_uuid(survey_id):          # Postgres would reject a bad uuid
            return None
        rows = self._table("surveys").select("*").eq("id", survey_id).execute().data
        return rows[0] if rows else None

    def create_survey(self, data):
        return self._table("surveys").insert(data).execute().data[0]

    def update_survey(self, survey_id, fields):
        if not _is_uuid(survey_id):
            return None
        rows = self._table("surveys").update(fields).eq("id", survey_id).execute().data
        return rows[0] if rows else None

    def delete_survey(self, survey_id):
        if not _is_uuid(survey_id):
            return False
        return bool(self._table("surveys").delete().eq("id", survey_id).execute().data)

    # -- readings
    def list_readings(self, survey_id):
        if not _is_uuid(survey_id):
            return []
        return self._table("readings").select("*").eq("survey_id", survey_id) \
            .order("time").execute().data

    def add_reading(self, data):
        return self._table("readings").insert(data).execute().data[0]

    def delete_reading(self, reading_id):
        if not _is_uuid(reading_id):
            return False
        return bool(self._table("readings").delete().eq("id", reading_id).execute().data)


def connect():
    """Try Supabase first; fall back to memory. Returns (store, message)."""
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_KEY", "").strip()
    if not url or not key:
        return MemoryStore(), "SUPABASE_URL / SUPABASE_KEY not set in backend/.env - using in-memory storage."
    try:
        return SupabaseStore(url, key), f"Connected to Supabase ({url})."
    except Exception as exc:   # bad key, no internet, tables missing...
        return MemoryStore(), f"Supabase unreachable ({exc}) - using in-memory storage."
