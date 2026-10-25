# Tests import the backend modules directly (backend/ on the path) and always
# use the in-memory store, even if backend/.env holds real Supabase keys:
# load_dotenv() does not override variables that are already set.
import os
import sys

import pytest

os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_KEY"] = ""
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def client(monkeypatch):
    """Flask test client on an empty in-memory store. The background sampler is
    not started; measurements get fake samples instead of the real adapter."""
    import app as backend
    backend.store.surveys.clear()
    backend.store.readings.clear()
    fake = [{"rssi": v, "ssid": "TestNet", "channel": 6, "band": "2.4 GHz", "method": "test", "error": None}
            for v in (-60, -62, -61, -63, -59, -60, -61, -62, -60, -61)]
    monkeypatch.setattr(backend.sampler, "wait_for_samples", lambda n, timeout=None: fake[:n])
    return backend.app.test_client()
