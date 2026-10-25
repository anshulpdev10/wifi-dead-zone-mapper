# Tests import the backend modules directly (backend/ on the path) and always
# use the in-memory store, even if backend/.env holds real Supabase keys:
# load_dotenv() does not override variables that are already set.
import os
import sys

os.environ["SUPABASE_URL"] = ""
os.environ["SUPABASE_KEY"] = ""
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
