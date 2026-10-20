# Wi-Fi Dead-Zone & Signal Mapping System

The laptop is the signal reader. A Flask backend on the same laptop reads the
laptop's own Wi-Fi signal **every second**. In a React dashboard you mark your
position on a floor plan as you walk; readings are saved, and the heatmap, dead
zones and statistics update live. It also scans nearby networks, shows channel
congestion, and calibrates the log-distance path-loss model from your own data.

```
backend/   Python Flask API, background sampler, Supabase (falls back to in-memory)
frontend/  React 18 + Vite dashboard, plain CSS, HTML canvas + inline SVG (no chart/map libraries)
```

> **Database note.** The original brief asked for MongoDB (pymongo + mongomock).
> This project uses **Supabase** (hosted Postgres) instead, with the same
> "memory mode" fallback, because Supabase was already set up and holding
> real survey data.

## Requirements

- Windows 10/11, Linux or macOS laptop with Wi-Fi, **connected to the network you want to map**
- Python 3.10+ (tested with 3.11.7), Node.js 18+ (tested with 22.16.0)
- A free Supabase project (optional; without it, data is kept in memory only)

## 1. Supabase setup (one time, and again after updates)

1. Create a project at https://supabase.com.
2. Open **SQL Editor → New query**, paste all of `backend/schema.sql`, and click **Run**.
   It is safe to run again. Re-running it adds the newer `channel`, `band` and `mode` columns.
3. Open **Project Settings → API / API Keys** and copy the **Project URL** and the
   **secret / service_role key**.
4. Copy `backend/.env.example` to `backend/.env` and fill in both values.

The key stays in the backend on your laptop. `.env` is in `.gitignore`; never commit it.

> **Memory mode.** If `.env` is missing, the key is wrong, the tables don't exist or
> there is no internet, the backend still starts but keeps data in memory.
> `/api/health` then reports `"db": "memory"` and the dashboard shows a yellow banner.
> Data is lost when the backend stops, so **use Export CSV before closing**.

## 2. Run the backend

```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate            # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python wifi_reader.py             # self-test: your network + a list of nearby networks
python app.py                     # API + live sampler on http://127.0.0.1:5000
```

Always run it with the venv's Python (`.venv\Scripts\python app.py`). The startup log shows `[db] mode=...`.

Optional **simulated** demo data (for testing only, never presented as real), in a
second terminal while `app.py` runs: `.venv\Scripts\python seed_demo.py`.

## 3. Run the frontend

```powershell
cd frontend
npm install
npm run dev                       # open http://localhost:5173
```

Vite forwards every `/api/...` request (including the live stream) to Flask, so both must be running.

### Watching on a phone (same Wi-Fi)

```powershell
npm run dev:lan                   # prints  Network: http://192.168.x.x:5173
```

Open that address on the phone. The phone only *shows* the dashboard; the signal is
still read by the laptop. That makes the phone handy as a remote control: carry the
laptop and tap your position on the phone. If Windows Firewall asks, allow Node.js on
**private** networks. (`python app.py --lan` also exposes the API itself on port 5000.)

## 4. Using it

**Top bar:** survey dropdown, **Survey around me** (a quick 12 × 8 m area),
**New survey** (your own size + optional floor-plan image), the click mode
(**Measure / Walk / Place router**), and the **Live / Disconnected** indicator for the
live stream (it reconnects by itself).

Before you start, decide which real wall is the map's **left** wall and which is the
**top** wall: (0, 0) is the top-left corner, and the rulers are in metres.

| Mode | A click on the map… |
|---|---|
| **Measure** | sets your position. With *Auto-measure* ticked, it measures there straight away for the chosen time (3–30 s, 1 sample per second); otherwise press **Measure here**. |
| **Walk** | saves a quick **3-sample** reading at once (~3 s). Click-click-click as you walk; the heatmap redraws after each one. |
| **Place router** | sets the router position (needed for calibration and what-if). |

**Guided 10-point survey.** Every survey shows 10 numbered targets (an even 5 × 2 grid,
in snake order). The Guide panel says exactly where to go, e.g. *"Walk to point 3:
6.0 m from left wall · 2.0 m from top wall"*. Then press **I'm here – measure**.

**Right panel**
1. **Live signal:** big dBm number, band, SSID, channel and band, and a 60-second graph
   with dashed lines at −67 and −75. Below −75 dBm the card turns red and shows
   *"Entering dead zone"*. There's an optional beep (off by default).
2. **Connection quality:** latency, jitter and packet loss of pings to your router.
3. **Results:** the extender verdict (★ required / ✓ not needed, with the spot), every
   dead zone, the healthy/marginal/dead split, and advice. Marked *preliminary* until
   the 10 guided points are done.
4. **Path-loss calibration:** n, A and R², plus a scatter of RSSI against distance with the fitted line.
5. **What-if:** tick *What-if (drag router)* above the map and drag. The map shows the
   *predicted* coverage with the router there, compared with today.
6. **Readings:** newest first, with delete, **Export CSV** and **Delete survey**.

**Networks tab:** a live table of nearby networks (yours highlighted), a 2.4 GHz chart
(each network drawn as a 22 MHz-wide hump) with the recommended channel, and a 5 GHz bar chart.

Thresholds: **Good ≥ −67 dBm**, **Dead < −75 dBm**. Colour bands: Excellent ≥ −50
(#2BB673), Good ≥ −67 (#8CCB5E), Fair ≥ −75 (#F2A93B), Weak ≥ −85 (#EE7B3D), Dead zone
below (#E2513C). Everything below −75 is outlined as a dead zone on the map.

## 5. How each feature works

| Feature | How |
|---|---|
| Reading the signal | `wifi_reader.py` runs the OS tool (`netsh` / `/proc/net/wireless` + `iw` / `system_profiler`) and parses its text. Windows 11 prints the real `Rssi`; otherwise `dBm ≈ Signal% / 2 − 100`. |
| Live updates | `sampler.py` runs a background thread: 1 reading per second into a 120-sample ring buffer, a network scan every 10 s, and a second thread pinging the router every second. `/api/stream` pushes each sample to every open dashboard with **Server-Sent Events** (one long HTTP response the browser keeps open). |
| Measure / Walk | The endpoint waits for N *new* samples from the sampler and saves their mean, standard deviation, min and max. Averaging smooths out fading (the signal's natural second-to-second wobble). |
| Heatmap | **IDW**: every 0.25 m cell gets a weighted average of the readings, `value = Σ wᵢ·RSSIᵢ / Σ wᵢ` with `wᵢ = 1/dᵢ²`, so nearer readings count more. |
| Dead zones | Cells below −75 dBm are grouped with a **BFS flood fill** (4 neighbours). Groups under 0.5 m² are ignored. Each zone gets its area, centre and worst value. |
| Extender spot | The cell at −67 dBm or better nearest to the centre of the biggest dead zone: an extender there still gets a strong signal but is as close as possible to the gap. |
| Calibration | Log-distance model `RSSI = A − 10·n·log₁₀(d)`. With `x = −10·log₁₀(d)` it is a straight line `RSSI = A + n·x`, fitted by **least squares** (numpy). **R² = 1 − SS_res/SS_tot**. A reading 8+ dB below the line is flagged *obstructed* (orange ring). n = 2 in free space and about 3 in homes; higher means more absorption. |
| What-if | `prediction = model(distance to new router) + IDW(residuals)`. The residuals keep what the model can't see (walls), assuming walls stay put. It's an estimate, so re-survey after moving the router. |
| Channel advice | Only 1, 6 and 11 don't overlap on 2.4 GHz. For each one, `load = Σ power_mW × overlap` with `overlap = max(0, 1 − |ch − c|/5)`; the lowest load wins. Your connected network is left out, but the app can't tell that a *different-band* network is also your router (e.g. your router's 2.4 GHz SSID), so that one still counts. |
| Jitter / loss | Over the last 30 pings: jitter = average change between consecutive round-trip times; loss = % without a reply. |

## Windows 11: "location permission" error

Newer Windows 11 builds hide Wi-Fi details from `netsh` unless Location is allowed:
**Settings → Privacy & security → Location**, turn on **Location services** and
**Let desktop apps access your location**, then restart `app.py`.

## API summary

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | server + db mode + gateway |
| GET | `/api/stream` | Server-Sent Events: `sample` (1/s), `reading`, `survey` |
| GET | `/api/history` | last 120 samples + connection quality |
| GET | `/api/rssi` | latest sample |
| GET | `/api/networks` | nearby networks + recommended 2.4 GHz channel |
| GET/POST | `/api/surveys` | list / create |
| GET/PATCH/DELETE | `/api/surveys/<id>` | one survey (PATCH: name, size, plan, router) |
| GET | `/api/surveys/<id>/readings` | readings |
| POST | `/api/surveys/<id>/measure` | `{x, y, samples}`: average 3–30 fresh samples |
| POST | `/api/surveys/<id>/walk` | `{x, y}`: quick 3-sample reading |
| POST | `/api/surveys/<id>/readings` | `{x, y, rssi}`: manual entry |
| DELETE | `/api/readings/<id>` | delete a reading |
| GET | `/api/surveys/<id>/map` | heatmap grid, dead zones, extender, stats, advice |
| GET | `/api/surveys/<id>/calibration` | A, n, R², fitted curve, residuals |
| GET | `/api/surveys/<id>/whatif?x=&y=` | predicted map with the router at (x, y) |
| GET | `/api/surveys/<id>/export.csv` | CSV download |

Errors are always JSON: `{"error": "..."}` with status 400/404/409/503.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Disconnected" / "Cannot reach the backend" | Start `.venv\Scripts\python app.py`. The dashboard reconnects by itself. |
| Changes don't show up / missing fields | Flask doesn't reload code (`use_reloader=False`). Press Ctrl+C and start it again. Only one `app.py` should run: Windows lets two share port 5000. |
| 500 errors | Run with the venv's Python so the pinned versions are used. The real error is printed in the backend terminal. |
| Health says "no channel/band/mode columns" | Re-run `backend/schema.sql` in Supabase. Until then, the mode is kept in the `method` column. |
| Meter says "Wi-Fi is not connected" | Turn Wi-Fi on and connect. |
| Location permission message | See the Windows 11 section. |
| Yellow "memory mode" banner | Check `backend/.env`, that `schema.sql` was run, and that you're online. |
| Supabase "permission denied" / empty lists | Use the secret / service_role key, not the anon key. |
| RSSI barely changes | Windows refreshes it every few seconds and it is stable when you stand still. Use Measure with 10 s or more per spot. |
| Calibration says "need 5 readings" | Place the router and take 5+ readings at different distances (0.5 m or more from it). |
| Phone can't open the dashboard | Use `npm run dev:lan`, the same Wi-Fi, and allow Node.js through the Windows Firewall (private networks). |
| Linux: no reading / no scan | Check `/proc/net/wireless`, and install `iw` / `wireless-tools` and NetworkManager (`nmcli`). |
