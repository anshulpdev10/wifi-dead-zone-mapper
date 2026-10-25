# Wi-Fi Dead-Zone & Signal Mapping System

The laptop is the signal reader. A Flask backend on the same laptop reads the
laptop's own Wi-Fi signal **every second**. In a React dashboard you either measure
**room by room** (Classroom, Lab, Bedroom… → which rooms are dead zones, and where an
extender should go) or run **Survey around me** (pick a range of 5–50 m, tap where you
are as you walk → live heatmap, dead zones and extender spot). It also scans nearby
networks, shows channel congestion, and calibrates the log-distance path-loss model
from your own data.

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
   It is safe to run again. Re-running it adds the newer `channel`, `band`, `mode`, `room` and `setup` columns.
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

Tests (no Wi-Fi or database needed, always memory mode):

```powershell
pip install -r requirements-dev.txt
python -m pytest tests -q          # mapping, netsh parsing, the whole REST API
```

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
**private** networks. (`python app.py --lan` also exposes the API itself on port 5000; Flask's
debug mode is switched off then, so its debugger is never reachable from other devices.)

## 4. Using it

**Top bar:** survey dropdown, **Survey around me**, **New survey**, and the
**Live / Disconnected** indicator for the live stream (it reconnects by itself).
**Tabs:** **Rooms** · **Floor map** · **Networks**.

> **Why you tap your position instead of using GPS.** The laptop can only measure Wi-Fi
> where it *is*, and it cannot sense where it is indoors: Windows' own location estimate
> is off by hundreds of metres (±500 m measured on the test laptop), and even phone GPS
> is off by 5–20 m inside a building, which is bigger than a classroom. So the app asks
> you instead: a room name, or a rough tap on the map. That's how professional Wi-Fi
> site surveys work too.

### A. Room by room (Rooms tab, the quickest answer)

1. **New survey** starts one straight away (no form: places are named with the room buttons).
2. Go to a room, hold the laptop where you normally use it (desk, bench, bed), pick the
   room (**College**: Classroom, Lab, Library…, **Home**: Bedroom, Kitchen…, **Office**,
   or type your own, e.g. *Lab 3*) and press **Measure**. It averages 5–30 s of samples
   and speaks the result.
3. Measure the same room again to add another spot; the room shows its average, best and worst.
4. **Results:** every room ranked with a colour bar (marks at −67 and −75 dBm), the verdict
   (*★ Extender required* / *✓ No extender needed*), the **best room for the extender**,
   **which room the router is probably in** (the strongest one), and tips.

### B. Survey around me (Floor map tab, a heatmap around you)

1. **Survey around me** → pick where you are (Classroom, Lab, …) and a **range**: 5, 10, 15,
   20, 30 or 50 m. You get a square map of that size with **you in the centre**, and
   the first reading is taken right there.
2. Press **▶ Start tracking** and walk, keeping the pointer on where you are: the mouse
   over the map, or your finger on the phone dashboard (`npm run dev:lan`). No clicking:
   a reading is saved **every 2 s** at that spot, and the heatmap, dead zones and readings
   grow along your path. Grey hatching = not measured yet.
3. **Where is my router?** After 4+ readings in different places the app works it out and
   marks **router?** on the map with an accuracy circle. Press *Yes, it's here* to use it
   (this unlocks calibration and what-if), or place it yourself.

| Mode (Floor map) | What happens |
|---|---|
| **Track my walk** | After *Start tracking*, the pointer is you: a reading (the newest live sample) every 2 s at the pointer, one per 6 s while you stand still. |
| **Tap to measure** | A tap measures there for the chosen time (3–30 s, 1 sample per second), more accurate. Untick *Measure as soon as I tap* to only set the marker and press **Measure here**. |
| **Place router** | A tap sets the router position. |

**Add floor plan** (map toolbar) puts a photo or drawing of the floor under the heatmap.

**Side panel (Floor map)**
1. **Live signal:** big dBm number, band, SSID, channel, and a 60-second graph with dashed
   lines at −67 and −75. Below −75 dBm the card turns red (*"Entering dead zone"*); optional beep.
2. **Measure:** time, auto-measure, manual dBm entry.
3. **Results:** extender verdict and spot, dead zones, healthy/marginal/dead split, *Floor measured %*, advice.
4. **Connection quality:** latency, jitter and packet loss of pings to your router.
5. **Path-loss calibration:** n, A and R², plus a scatter of RSSI against distance with the fitted line.
6. **What-if:** tick *What-if (drag router)* and drag. The map shows the *predicted* coverage
   with the router there, compared with today.
7. **Readings:** newest first, with delete, **Export CSV** and **Delete survey**.

**Networks tab:** a live table of nearby networks (yours highlighted), a 2.4 GHz chart
(each network drawn as a 22 MHz-wide hump) with the recommended channel, and a 5 GHz bar chart.

Thresholds: **Good ≥ −67 dBm**, **Dead < −75 dBm**. Colour bands: Excellent ≥ −50
(#2BB673), Good ≥ −67 (#8CCB5E), Fair ≥ −75 (#F2A93B), Weak ≥ −85 (#EE7B3D), Dead zone
below (#E2513C). Everything below −75 is outlined as a dead zone on the map.

## 5. How each feature works

| Feature | How |
|---|---|
| Reading the signal | `wifi_reader.py` runs the OS tool (`netsh` / `/proc/net/wireless` + `iw` / `system_profiler`) and parses its text. Windows 11 prints the real `Rssi`; otherwise `dBm ≈ Signal% / 2 − 100`. |
| Live updates | `sampler.py` runs a background thread: 1 reading per second into a 120-sample ring buffer, the nearby-network list every 10 s, and a second thread pinging the router every second. `netsh` only shows Windows' cached network list, so while the Networks tab is open the sampler asks Windows for a real scan (`WlanScan` in wlanapi.dll, via ctypes) and reads the list 4 s later. Scans are not forced otherwise, because they briefly take the radio off-channel and would spoil the ping numbers during a survey. `/api/stream` pushes each sample to every open dashboard with **Server-Sent Events** (one long HTTP response the browser keeps open). |
| Measure / Walk | The endpoint waits for N *new* samples from the sampler and saves their mean, standard deviation, min and max. Averaging smooths out fading (the signal's natural second-to-second wobble). |
| Heatmap | **IDW**: every 0.25 m cell (coarser on floors over ~37 m, max ~150 cells per side) gets a weighted average of the readings, `value = Σ wᵢ·RSSIᵢ / Σ wᵢ` with `wᵢ = 1/dᵢ²`, so nearer readings count more. Cells farther than `max(3 m, √(area/10))` from every reading are **not measured yet** (grey hatching) instead of guessed, so the first reading does not colour the whole floor. Readings spread over the area (about one every few metres) cover it all. Percentages are of the measured part; *Floor measured* shows how much that is. |
| Dead zones | Measured cells below −75 dBm are grouped with a **BFS flood fill** (4 neighbours). Groups under 0.5 m² are ignored. Each zone gets its area, centre and worst value. |
| Router estimate | For every candidate spot on a fine grid, fit `RSSI = A − 10·n·log₁₀(d)` (d = distance from that spot to each reading) by least squares, all candidates at once with numpy, and keep the best fit with a sensible n (1.5–6). The accuracy circle covers every spot that fits almost as well (at least 1 m). Walls bend the signal, so it's labelled an estimate; a spot on the edge means the router is probably just outside the area. |
| Room-by-room | Readings are grouped by room name. A room's status comes from its average: good ≥ −67, fair −75…−67, dead < −75. An extender is needed when any room is dead; it goes in the **weakest room that still has good signal**, the edge of good coverage and the closest strong spot to the dead rooms. (The app doesn't know how rooms connect, so it also says to pick the side nearest the dead room; if only the router's room is good, it says to measure on the way and use the last spot that's still ≥ −67.) |
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
| POST | `/api/surveys/<id>/track` | `{x, y}`: newest live sample saved at x, y (track mode) |
| POST | `/api/surveys/<id>/rooms/measure` | `{room, samples}`: room-by-room reading |
| GET | `/api/surveys/<id>/rooms` | per-room signal, extender verdict + room, advice |
| DELETE | `/api/surveys/<id>/rooms/<name>` | delete one room's readings |
| DELETE | `/api/readings/<id>` | delete a reading |
| GET | `/api/surveys/<id>/map` | heatmap grid, dead zones, extender, stats, advice |
| GET | `/api/surveys/<id>/calibration` | A, n, R², fitted curve, residuals |
| GET | `/api/surveys/<id>/whatif?x=&y=` | predicted map with the router at (x, y) |
| GET | `/api/surveys/<id>/export.csv` | CSV download |

Errors are always JSON: `{"error": "..."}` with status 400/404/409/503.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Disconnected" / "Cannot reach the backend" | Start `.venv\Scripts\python app.py`. The dashboard reconnects by itself and reloads the survey list (no page refresh needed). |
| Changes don't show up / missing fields | Flask doesn't reload code (`use_reloader=False`). Press Ctrl+C and start it again. Only one `app.py` should run: Windows lets two share port 5000. |
| 500 errors | Run with the venv's Python so the pinned versions are used. The real error is printed in the backend terminal. |
| Health says "no channel/band/mode columns" | Re-run `backend/schema.sql` in Supabase. Until then, the mode is kept in the `method` column. |
| Meter says "Wi-Fi is not connected" | Turn Wi-Fi on and connect. |
| Location permission message | See the Windows 11 section. |
| Yellow "memory mode" banner | Check `backend/.env`, that `schema.sql` was run, and that you're online. |
| Supabase "permission denied" / empty lists | Use the secret / service_role key, not the anon key. |
| RSSI barely changes | Windows refreshes it every few seconds and it is stable when you stand still. Use Measure with 10 s or more per spot. |
| Calibration says "need 5 readings" | Place the router and take 5+ readings at different distances (0.5 m or more from it). |
| Banner "Your Supabase tables are missing the newest columns" | Re-run `backend/schema.sql` in the Supabase SQL Editor and restart `app.py`. Until then everything still works (a reading's room is kept in the `method` column), but readings don't store channel/band. |
| No spoken result | Tick *Speak the result* on the Rooms tab and check the laptop's volume. Speech uses the browser's built-in voices. |
| Phone can't open the dashboard | Use `npm run dev:lan`, the same Wi-Fi, and allow Node.js through the Windows Firewall (private networks). |
| Linux: no reading / no scan | Check `/proc/net/wireless`, and install `iw` / `wireless-tools` and NetworkManager (`nmcli`). |
