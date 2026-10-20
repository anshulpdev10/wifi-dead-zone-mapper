# Wi-Fi Dead-Zone & Signal Mapping System

Walk around a floor with your laptop, click your position on a floor plan, and
the backend (running on the same laptop) reads the laptop's own Wi-Fi RSSI,
averages several samples and saves them. From the readings it builds an
interpolated heatmap, flags dead zones and suggests where to put an extender.

```
backend/   Python Flask API + Supabase (falls back to in-memory storage)
frontend/  React 18 + Vite dashboard, plain CSS, HTML canvas map
```

## Requirements

- Windows 10/11, Linux or macOS laptop with Wi-Fi, **connected to the network you want to map**
- Python 3.10+ (tested with 3.11.7)
- Node.js 18+ (tested with 22.16.0)
- A free Supabase project (optional; without it data is kept in memory only)

## 1. Supabase setup (one time)

1. Create a project at https://supabase.com.
2. Open **SQL Editor → New query**, paste the contents of `backend/schema.sql`, click **Run**.
3. Open **Project Settings → API / API Keys** and copy the **Project URL** and the
   **secret / service_role key**.
4. Copy `backend/.env.example` to `backend/.env` and fill both values in.

The key stays on your laptop in the backend only. `.env` is in `.gitignore`. Never commit it.

> **Memory mode.** If `.env` is missing, the key is wrong, the tables don't exist or
> there is no internet, the backend still starts but keeps data in memory.
> `GET /api/health` then reports `"db": "memory"` and the dashboard shows a yellow
> banner. Everything works, but data is lost when the backend stops, so
> **use Export CSV before closing**.

## 2. Run the backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate            # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python wifi_reader.py             # quick check: should print your SSID and dBm
python app.py                     # API on http://127.0.0.1:5000
```

The startup log shows `[db] mode=supabase` or `[db] mode=memory`.

Optional demo data (simulated, **for testing only**), in a second terminal while `app.py` runs:

```powershell
cd backend
.venv\Scripts\python seed_demo.py
```

## 3. Run the frontend

```powershell
cd frontend
npm install
npm run dev                       # open http://localhost:5173
```

Vite forwards every `/api/...` request to the Flask server, so both must be running.

## 4. Doing a survey

**Quick way: "Survey around me".** One click creates a 12 × 8 m area with you at the
centre (6, 4) and measures there straight away. The heatmap starts from that first
reading, and a ring around your marker shows the live signal where you stand.

1. Pick the measuring **Time** in the dropdown (1 sample per second, default 10 s).
2. Keep **Auto-measure when I click the map** ticked (it is on by default).
3. Walk to a new spot, click that spot on the map, and hold still until the bar finishes.
   Each click is measured and saved automatically, and the heatmap rebuilds.
4. Optional: choose **Place router** and click where the router is.

**Custom floor: "New survey".** Enter a name and the real floor size in metres, and
optionally add a floor-plan image. Then measure the same way. With auto-measure off,
click your spot and press **Measure here**.

The heatmap appears from the 1st reading. Dead zones, the extender ★ and the statistics
need **3+ readings**, and 8 or more well-spread points give a good map.

> Why click your position instead of using GPS? Browser / laptop location comes from
> GPS or Wi-Fi positioning and is only accurate to tens of metres indoors, which is
> bigger than the whole room. So your position inside the room comes from where you click.
5. Read the **Coverage** panel: healthy / marginal / dead %, dead area, advice, and the
   ★ suggested extender spot on the map.
6. **Export CSV** to keep the raw readings.

Thresholds: **Good ≥ −67 dBm**, **Dead < −75 dBm**.
Colour bands: Excellent ≥ −50, Good ≥ −67, Fair ≥ −75, Weak ≥ −85, Dead zone below.

## Windows 11: "location permission" error

Newer Windows 11 builds hide Wi-Fi details from `netsh` unless Location is allowed.
If the meter shows a Location message:

1. **Settings → Privacy & security → Location**
2. Turn on **Location services**
3. Turn on **Let apps access your location** and **Let desktop apps access your location**
4. Restart `app.py`

## API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | server + db mode |
| GET | `/api/rssi` | one live reading |
| GET/POST | `/api/surveys` | list / create |
| GET/PATCH/DELETE | `/api/surveys/<id>` | one survey (PATCH: name, size, plan, router) |
| GET | `/api/surveys/<id>/readings` | readings |
| POST | `/api/surveys/<id>/measure` | `{x, y, samples}`: real measurement (3–30 samples) |
| POST | `/api/surveys/<id>/readings` | `{x, y, rssi}`: manual entry |
| DELETE | `/api/readings/<id>` | delete a reading |
| GET | `/api/surveys/<id>/map` | heatmap grid, dead regions, extender, stats, advice |
| GET | `/api/surveys/<id>/export.csv` | CSV download |

Errors are always JSON: `{"error": "..."}` with status 400/404/503.

## Troubleshooting

| Problem | Fix |
|---|---|
| Red banner "Cannot reach the backend" | Start `python app.py` and check port 5000 is free. |
| Meter says "Wi-Fi is not connected" | Turn Wi-Fi on and connect. The adapter must be associated to read RSSI. |
| Location permission message (Windows 11) | See the section above. |
| Yellow "memory mode" banner | Check `backend/.env`, check that `schema.sql` was run and that you're online; read the `[db]` line in the backend log. |
| Supabase "permission denied" / empty lists | You used the anon/publishable key. Use the secret / service_role key. |
| Value is `netsh-signal%` instead of `netsh-rssi` | Older Windows has no Rssi line, so dBm is estimated as Signal% / 2 − 100. Still fine for mapping. |
| Readings jump around | Use more samples (15–30), hold still, and don't block the laptop's antenna (screen hinge) with your body. |
| Map says "Need at least 3 readings" | Add more points. IDW needs at least 3. |
| Floor-plan upload "too large" | Images are downscaled to 1400 px automatically; try a different image format if it still fails. |
| Linux: no reading | Check that `/proc/net/wireless` lists your adapter; install `wireless-tools` for `iwgetid`. |
