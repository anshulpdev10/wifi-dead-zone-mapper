// App.jsx - the dashboard. Holds all shared state and talks to the backend;
// the components in ./components only display data and report user actions.
//
// Layout:  top bar  (survey dropdown, Survey around me, New survey, Live indicator)
//          tabs     Rooms | Floor map | Networks
//          Rooms:     measure room by room (classroom, lab, bedroom…) -> ranked
//                     rooms + "extender needed? where?"            [+ live meter]
//          Floor map: "survey around me" heatmap - tap where you are, it measures;
//                     dead zones, extender spot, calibration, what-if, readings
//          Networks:  nearby networks table + channel charts
import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { describePosition } from './position.js'
import { useLiveStream } from './useLiveStream.js'
import { bandFor } from './bands.js'
import { say, unlockAudio, beep } from './sound.js'
import AroundMeForm from './components/AroundMeForm.jsx'
import CalibrationPanel from './components/CalibrationPanel.jsx'
import FloorMap from './components/FloorMap.jsx'
import Legend from './components/Legend.jsx'
import MeasurePanel from './components/MeasurePanel.jsx'
import NetworksTab from './components/NetworksTab.jsx'
import NewSurveyForm from './components/NewSurveyForm.jsx'
import QualityCard from './components/QualityCard.jsx'
import ReadingsList from './components/ReadingsList.jsx'
import RoomsTab from './components/RoomsTab.jsx'
import SignalMeter from './components/SignalMeter.jsx'
import StatsPanel from './components/StatsPanel.jsx'
import WhatIfCard from './components/WhatIfCard.jsx'

const MODES = [
  ['measure', 'Measure'],      // click = set position (+ auto-measure N s)
  ['walk', 'Walk'],            // click = quick 3-sample reading, saved at once
  ['router', 'Place router'],  // click = router position
]
const TABS = [['rooms', 'Rooms'], ['map', 'Floor map'], ['networks', 'Networks']]

export default function App() {
  const [health, setHealth] = useState(null)          // {db: "supabase" | "memory", ...}
  const [backendError, setBackendError] = useState('')
  const [tab, setTab] = useState('rooms')
  const [surveys, setSurveys] = useState([])          // list for the dropdown
  const [surveyId, setSurveyId] = useState(null)      // selected survey
  const [survey, setSurvey] = useState(null)          // full survey (plan, router)
  const [readings, setReadings] = useState([])        // every reading (rooms + floor map)
  const [map, setMap] = useState(null)                // result of /map
  const [calibration, setCalibration] = useState(null) // result of /calibration
  const [rooms, setRooms] = useState(null)            // result of /rooms
  const [creating, setCreating] = useState(null)      // null | 'around' | 'new'
  const [mode, setMode] = useState('measure')
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [selected, setSelected] = useState(null)      // {x, y} in metres
  const [busy, setBusy] = useState(null)              // null | 'measure' | 'walk' | 'room'
  const [samples, setSamples] = useState(10)          // measurement time: 1 sample per second
  const [autoMeasure, setAutoMeasure] = useState(true) // Measure mode: click = measure at once
  const [voice, setVoice] = useState(true)            // speak each result
  const [lastAddedId, setLastAddedId] = useState(null) // newest point pulses on the map
  const [notice, setNotice] = useState(null)          // {kind: 'ok' | 'error', text}
  const [whatIfMode, setWhatIfMode] = useState(false)
  const [whatIf, setWhatIf] = useState(null)          // {router, result} or {router, error}
  const surveyIdRef = useRef(null)
  surveyIdRef.current = surveyId
  const refreshTimer = useRef(null)
  const whatIfBusy = useRef(false)                    // one prediction request at a time
  const whatIfNext = useRef(null)                     // latest drag position while busy
  const startAt = useRef(null)                        // "survey around me": {id, point} to measure first

  // Live data: one sample per second + "a reading was saved" events.
  const stream = useLiveStream((type, data) => {
    if (type === 'reading') {
      const mine = data.survey_id === surveyIdRef.current
      if (data.action === 'added' && mine) setLastAddedId(data.reading.id)
      if (mine || data.action === 'deleted') scheduleRefresh()
    } else if (type === 'survey') {
      if (data.deleted) refreshSurveys()
      else if (data.survey_id === surveyIdRef.current) {
        api.get(`/surveys/${data.survey_id}`).then(setSurvey).catch(() => {})
        scheduleRefresh()
      }
    }
  })

  const roomReadings = readings.filter((r) => r.room)
  const mapReadings = readings.filter((r) => !r.room)
  const obstructedIds = new Set((calibration?.points || []).filter((p) => p.obstructed).map((p) => p.id))

  const showError = (err) => setNotice({ kind: 'error', text: err.message })
  const showOk = (text) => setNotice({ kind: 'ok', text })
  const speak = (text) => { if (voice) say(text) }

  // On start, and every time the live stream (re)connects - e.g. the backend was
  // started after the dashboard, or restarted - check the backend and reload the
  // survey list, so an old "cannot reach the backend" error clears by itself.
  useEffect(() => {
    if (stream.status === 'disconnected') return
    api.get('/health')
      .then((h) => { setHealth(h); setBackendError('') })
      .catch((err) => setBackendError(err.message))
    refreshSurveys()
  }, [stream.status === 'live'])

  // Success messages disappear after 5 seconds; errors stay until dismissed.
  useEffect(() => {
    if (notice?.kind !== 'ok') return
    const timer = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(timer)
  }, [notice])

  // Whenever the selected survey changes, load everything about it.
  useEffect(() => {
    setSurvey(null); setReadings([]); setMap(null); setCalibration(null); setRooms(null)
    setSelected(null); setWhatIfMode(false); setWhatIf(null)
    if (!surveyId) return
    let active = true
    Promise.all([
      api.get(`/surveys/${surveyId}`),
      api.get(`/surveys/${surveyId}/readings`),
      api.get(`/surveys/${surveyId}/map`),
      api.get(`/surveys/${surveyId}/calibration`),
      api.get(`/surveys/${surveyId}/rooms`),
    ])
      .then(([s, r, m, c, rm]) => {
        if (!active) return
        setSurvey(s); setReadings(r); setMap(m); setCalibration(c); setRooms(rm)
        // "Survey around me": take the first reading where the user stands (the centre).
        if (startAt.current?.id === surveyId) {
          const point = startAt.current.point
          startAt.current = null
          setSelected(point)
          measureAt(point)
        }
      })
      .catch((err) => active && showError(err))
    return () => { active = false }
  }, [surveyId])

  async function refreshSurveys(preferId) {
    try {
      const list = await api.get('/surveys')
      setBackendError('')
      setSurveys(list)
      setSurveyId((current) => {
        const wanted = preferId ?? current
        return list.some((s) => s.id === wanted) ? wanted : list[0]?.id ?? null
      })
      if (list.length === 0) setCreating((c) => c || 'around')
    } catch (err) {
      setBackendError(err.message)
    }
  }

  // Reload readings, heatmap, calibration and room results after any change.
  async function refreshReadings(id = surveyIdRef.current) {
    if (!id) return
    try {
      const [r, m, c, rm] = await Promise.all([
        api.get(`/surveys/${id}/readings`),
        api.get(`/surveys/${id}/map`),
        api.get(`/surveys/${id}/calibration`),
        api.get(`/surveys/${id}/rooms`),
      ])
      if (id !== surveyIdRef.current) return        // user switched survey meanwhile
      setReadings(r); setMap(m); setCalibration(c); setRooms(rm)
    } catch (err) {
      showError(err)
    }
  }

  // Several events can arrive together (e.g. our own save + the stream's event):
  // wait 250 ms and refresh once.
  function scheduleRefresh() {
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => refreshReadings(), 250)
  }

  // ------------------------------------------------------------ actions
  async function handleCreate(data) {
    const created = await api.post('/surveys', data)   // errors are shown by the form
    setCreating(null)
    setTab('rooms')
    await refreshSurveys(created.id)
    showOk(`Survey “${created.name}” created. Go to a room, pick its name and press Measure.`)
  }

  // "Survey around me": a range x range m map with the user in the centre.
  // The first reading is taken straight away at the centre (see the load effect).
  async function handleAroundMe(place, range) {
    unlockAudio()                                       // allowed: called from a click
    const created = await api.post('/surveys', { name: `${place} – ${range} m around me`, width: range, height: range })
    startAt.current = { id: created.id, point: { x: range / 2, y: range / 2 } }
    setCreating(null)
    setMode('measure'); setAutoMeasure(true)
    setTab('map')
    await refreshSurveys(created.id)
    showOk(`Measuring where you stand (the centre) for ${samples} s… Then walk, stop and tap where you are.`)
  }

  // A click on the map - what happens depends on the mode.
  async function handlePick(point) {
    if (mode === 'router') {
      try {
        setSurvey(await api.patch(`/surveys/${surveyId}`, { router: point }))
        showOk(`Router placed at ${describePosition(point)}.`)
        scheduleRefresh()                            // calibration depends on the router
      } catch (err) {
        showError(err)
      }
      return
    }
    if (busy) {
      showError(new Error(busy === 'walk'
        ? 'Still recording the previous spot (about 3 s) - tap again in a moment.'
        : 'A measurement is still running - wait for it to finish, then tap your next spot.'))
      return
    }
    setSelected(point)
    if (mode === 'walk') walkAt(point)
    else if (autoMeasure) measureAt(point)
  }

  // Shared by every kind of measurement: run the request, show + speak the result, refresh.
  async function record(kind, request, where) {
    setBusy(kind)
    setNotice(null)
    try {
      const r = await request()
      setLastAddedId(r.id)
      const label = where(r)
      showOk(`Saved ${r.rssi_mean} dBm ± ${r.rssi_std} ${label} (${r.samples.length} samples).`)
      beep(880, 0.15)
      if (kind !== 'walk') speak(`${r.room ? r.room + ': ' : ''}${Math.round(r.rssi_mean)} dBm, ${bandFor(r.rssi_mean).name}.`)
      await refreshReadings()
      return r
    } catch (err) {
      showError(err)
      return null
    } finally {
      setBusy(null)
    }
  }

  // Measure: the backend averages `samples` fresh samples (1 per second).
  const measureAt = (point) => record('measure',
    () => api.post(`/surveys/${surveyIdRef.current}/measure`, { ...point, samples }),
    (r) => `at ${describePosition(r)}`)
  // Walk: quick 3-sample reading, saved immediately.
  const walkAt = (point) => record('walk',
    () => api.post(`/surveys/${surveyIdRef.current}/walk`, point),
    (r) => `at ${describePosition(r)}`)
  // Room-by-room: average `samples` samples and file them under the room's name.
  const measureRoom = (room) => {
    unlockAudio()
    return record('room', () => api.post(`/surveys/${surveyId}/rooms/measure`, { room, samples }),
      (r) => `in ${r.room}`)
  }

  async function handleDeleteRoom(name) {
    if (!window.confirm(`Delete all readings of “${name}”?`)) return
    try {
      await api.del(`/surveys/${surveyId}/rooms/${encodeURIComponent(name)}`)
      await refreshReadings()
    } catch (err) {
      showError(err)
    }
  }

  // What-if: while dragging, ask the backend for a prediction. If a request is
  // already running, remember only the newest position and send it afterwards.
  async function handleWhatIf(point) {
    if (whatIfBusy.current) { whatIfNext.current = point; return }
    whatIfBusy.current = true
    try {
      const result = await api.get(`/surveys/${surveyId}/whatif?x=${point.x}&y=${point.y}`)
      setWhatIf({ router: point, result })
    } catch (err) {
      setWhatIf({ router: point, error: err.message })
    } finally {
      whatIfBusy.current = false
      const next = whatIfNext.current
      whatIfNext.current = null
      if (next) handleWhatIf(next)
    }
  }

  async function applyWhatIf() {
    try {
      setSurvey(await api.patch(`/surveys/${surveyId}`, { router: whatIf.router }))
      showOk(`Router set to ${describePosition(whatIf.router)}. Re-survey to confirm the prediction.`)
      setWhatIfMode(false); setWhatIf(null)
      scheduleRefresh()
    } catch (err) {
      showError(err)
    }
  }

  async function handleManual(rssi) {
    try {
      const r = await api.post(`/surveys/${surveyId}/readings`, { ...selected, rssi })
      setLastAddedId(r.id)
      showOk(`Added manual reading ${rssi} dBm.`)
      await refreshReadings()
      return true
    } catch (err) {
      showError(err)
      return false
    }
  }

  async function handleDeleteReading(id) {
    try {
      await api.del(`/readings/${id}`)
      await refreshReadings()
    } catch (err) {
      showError(err)
    }
  }

  async function handleDeleteSurvey() {
    if (!window.confirm(`Delete “${survey.name}” and all its readings? This cannot be undone.`)) return
    try {
      await api.del(`/surveys/${surveyId}`)
      showOk('Survey deleted.')
      await refreshSurveys()
    } catch (err) {
      showError(err)
    }
  }

  // ------------------------------------------------------------ render
  const statusLabel = { live: 'Live', connecting: 'Connecting…', disconnected: 'Disconnected' }[stream.status]
  const hint = {
    measure: autoMeasure
      ? `Walk, stop, and tap where you are now - it measures there for ${samples} s. Roughly is fine.`
      : 'Tap where you are standing, then press “Measure here”. Arrow keys move the marker.',
    walk: 'Walk mode: tap your spot each time you stop - a quick 3-sample reading (~3 s) is saved and the map redraws.',
    router: 'Tap where the router is (needed for calibration and what-if).',
  }[mode]
  const exportHref = `/api/surveys/${surveyId}/export.csv`

  let content
  if (tab === 'networks') {
    content = <main className="single wide"><NetworksTab live={stream.latest} /></main>
  } else if (creating) {
    content = (
      <main className="single">
        {creating === 'around'
          ? <AroundMeForm onStart={handleAroundMe} onCancel={() => setCreating(null)} canCancel={surveys.length > 0} />
          : <NewSurveyForm onCreate={handleCreate} onCancel={() => setCreating(null)} canCancel={surveys.length > 0} />}
      </main>
    )
  } else if (!survey) {
    content = <main className="single"><p className="muted">Loading…</p></main>
  } else if (tab === 'rooms') {
    content = (
      <main className="layout">
        <RoomsTab result={rooms} busy={busy} samples={samples} onSamplesChange={setSamples}
          voice={voice} onVoiceChange={setVoice} onMeasure={measureRoom} onDeleteRoom={handleDeleteRoom}
          exportHref={exportHref} onDeleteSurvey={handleDeleteSurvey} />
        <aside className="side-panel">
          <SignalMeter samples={stream.samples} latest={stream.latest} status={stream.status} />
          <QualityCard latest={stream.latest} />
          {roomReadings.length === 0 && mapReadings.length > 0 && (
            <p className="muted small">This survey has {mapReadings.length} floor-map reading(s) – see the Floor map tab.</p>
          )}
        </aside>
      </main>
    )
  } else {
    content = (
      <main className="layout">
        <section className="map-panel" aria-label="Floor map">
          <div className="toolbar">
            <div className="segmented" role="group" aria-label="What a tap on the map does">
              {MODES.map(([key, label]) => (
                <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
              Heatmap
            </label>
            {calibration?.ready && (
              <label className="check">
                <input type="checkbox" checked={whatIfMode}
                  onChange={(e) => { setWhatIfMode(e.target.checked); if (!e.target.checked) setWhatIf(null) }} />
                What-if (drag router)
              </label>
            )}
            <span className="muted small">{survey.width} × {survey.height} m</span>
            {busy && <span className="busy-tag" role="status">{busy === 'walk' ? 'Recording spot…' : 'Measuring…'}</span>}
          </div>
          <FloorMap survey={survey} readings={mapReadings} map={map} showHeatmap={showHeatmap}
            mode={mode} selected={selected} live={stream.latest?.rssi ?? null}
            obstructedIds={obstructedIds} lastAddedId={lastAddedId}
            whatIfMode={whatIfMode} whatIf={whatIf} onWhatIf={handleWhatIf}
            onSelect={setSelected} onPick={handlePick} />
          <p className="muted small">{hint}</p>
          <Legend />
        </section>

        <aside className="side-panel">
          <SignalMeter samples={stream.samples} latest={stream.latest} status={stream.status} />
          <MeasurePanel mode={mode} selected={selected} measuring={!!busy}
            samples={samples} onSamplesChange={setSamples}
            autoMeasure={autoMeasure} onAutoChange={setAutoMeasure}
            onMeasure={() => measureAt(selected)} onManual={handleManual} />
          <StatsPanel map={map} />
          <QualityCard latest={stream.latest} />
          <CalibrationPanel calibration={calibration} />
          <WhatIfCard calibration={calibration} whatIfMode={whatIfMode} whatIf={whatIf} current={map}
            onToggle={(on) => { setWhatIfMode(on); if (!on) setWhatIf(null) }} onApply={applyWhatIf} />
          <ReadingsList surveyId={surveyId} readings={mapReadings} obstructedIds={obstructedIds}
            onDeleteReading={handleDeleteReading} onDeleteSurvey={handleDeleteSurvey} />
        </aside>
      </main>
    )
  }

  return (
    <div className="app">
      <header className="header">
        <h1>Wi-Fi Signal Mapper</h1>
        <div className="header-controls">
          <label htmlFor="survey-select" className="sr-only">Survey</label>
          <select id="survey-select" value={surveyId ?? ''} disabled={!surveys.length || !!busy}
            onChange={(e) => { setCreating(null); setSurveyId(e.target.value) }}>
            {!surveys.length && <option value="">No surveys yet</option>}
            {surveys.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="primary" onClick={() => { setCreating('around'); setTab((t) => (t === 'networks' ? 'map' : t)) }}
            disabled={!!busy}>Survey around me</button>
          <button onClick={() => { setCreating('new'); setTab((t) => (t === 'networks' ? 'rooms' : t)) }}
            disabled={!!busy}>New survey</button>
          <span className={`live-status ${stream.status}`} role="status" aria-live="polite">
            <span className="dot" aria-hidden="true" />{statusLabel}
          </span>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Views">
        {TABS.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>

      {backendError && <div className="banner error" role="alert">{backendError}</div>}
      {health?.db === 'memory' && (
        <div className="banner warn" role="status">
          <span>
            Database is in <strong>memory mode</strong> (Supabase not connected) — data is lost when the
            backend stops. Export CSV before closing.
          </span>
        </div>
      )}
      {health?.db === 'supabase' && health.schema_ok === false && (
        <div className="banner warn" role="status">
          <span>
            Your Supabase tables are missing the newest columns. Open Supabase → <strong>SQL Editor</strong>, paste
            all of <code>backend/schema.sql</code> and press Run, then restart <code>app.py</code>. (Everything
            still works; until then the channel/band of each reading is not stored.)
          </span>
        </div>
      )}
      {notice && (
        <div className={`banner ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button className="icon" onClick={() => setNotice(null)} aria-label="Dismiss message">✕</button>
        </div>
      )}

      {content}
    </div>
  )
}
