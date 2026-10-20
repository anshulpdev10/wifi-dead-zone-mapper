// App.jsx - the dashboard. Holds all shared state and talks to the backend;
// the components in ./components only display data and report user actions.
//
// Layout:  header (survey dropdown + New survey)
//          [ floor map + toolbar + legend ]  [ side panel: meter, measure, stats, readings ]
import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import FloorMap from './components/FloorMap.jsx'
import Legend from './components/Legend.jsx'
import MeasurePanel from './components/MeasurePanel.jsx'
import NewSurveyForm from './components/NewSurveyForm.jsx'
import ReadingsList from './components/ReadingsList.jsx'
import SignalMeter from './components/SignalMeter.jsx'
import StatsPanel from './components/StatsPanel.jsx'

export default function App() {
  const [health, setHealth] = useState(null)          // {db: "supabase" | "memory", ...}
  const [backendError, setBackendError] = useState('')
  const [surveys, setSurveys] = useState([])          // list for the dropdown
  const [surveyId, setSurveyId] = useState(null)      // selected survey
  const [survey, setSurvey] = useState(null)          // full survey (plan, router)
  const [readings, setReadings] = useState([])
  const [map, setMap] = useState(null)                // result of /map
  const [creating, setCreating] = useState(false)     // showing the New survey form?
  const [mode, setMode] = useState('position')        // 'position' | 'router'
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [selected, setSelected] = useState(null)      // {x, y} in metres
  const [measuring, setMeasuring] = useState(false)
  const [samples, setSamples] = useState(10)          // measurement time: 1 sample per second
  const [autoMeasure, setAutoMeasure] = useState(true) // click on map = measure immediately
  const [live, setLive] = useState(null)              // latest live RSSI from the meter
  const [notice, setNotice] = useState(null)          // {kind: 'ok' | 'error', text}
  const startAroundMe = useRef(null)                  // survey id created by "Survey around me"

  const showError = (err) => setNotice({ kind: 'error', text: err.message })
  const showOk = (text) => setNotice({ kind: 'ok', text })

  // On start: check the backend and load the survey list.
  useEffect(() => {
    api.get('/health').then(setHealth).catch((err) => setBackendError(err.message))
    refreshSurveys()
  }, [])

  // Success messages disappear after 4 seconds; errors stay until dismissed.
  useEffect(() => {
    if (notice?.kind !== 'ok') return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  // Whenever the selected survey changes, load its details, readings and map.
  useEffect(() => {
    setSurvey(null); setReadings([]); setMap(null); setSelected(null)
    if (!surveyId) return
    let active = true
    Promise.all([
      api.get(`/surveys/${surveyId}`),
      api.get(`/surveys/${surveyId}/readings`),
      api.get(`/surveys/${surveyId}/map`),
    ])
      .then(([s, r, m]) => {
        if (!active) return
        setSurvey(s); setReadings(r); setMap(m)
        // "Survey around me": I am standing at the centre of the new area.
        if (startAroundMe.current === s.id) {
          startAroundMe.current = null
          const centre = { x: s.width / 2, y: s.height / 2 }
          setSelected(centre)
          if (autoMeasure) measureAt(centre, s.id)
        }
      })
      .catch((err) => active && showError(err))
    return () => { active = false }
  }, [surveyId])

  async function refreshSurveys(preferId) {
    try {
      const list = await api.get('/surveys')
      setSurveys(list)
      setSurveyId((current) => {
        const wanted = preferId ?? current
        return list.some((s) => s.id === wanted) ? wanted : list[0]?.id ?? null
      })
      if (list.length === 0) setCreating(true)
    } catch (err) {
      setBackendError(err.message)
    }
  }

  // Reload readings + heatmap after any change to the readings.
  async function refreshReadings(id = surveyId) {
    const [r, m] = await Promise.all([
      api.get(`/surveys/${id}/readings`),
      api.get(`/surveys/${id}/map`),
    ])
    setReadings(r)
    setMap(m)
  }

  // ------------------------------------------------------------ actions
  async function handleCreate(data) {
    const created = await api.post('/surveys', data)   // errors are shown by the form
    setCreating(false)
    await refreshSurveys(created.id)
    showOk(`Survey “${created.name}” created. Click the map where you are standing.`)
  }

  // "Survey around me": a 12 x 8 m area with me at the centre, measured right away.
  // (Browser GPS/geolocation is only accurate to tens of metres indoors, so the
  // position inside the room always comes from clicking the map.)
  async function handleSurveyAroundMe() {
    try {
      const name = `Around me ${new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
      const created = await api.post('/surveys', { name, width: 12, height: 8 })
      startAroundMe.current = created.id
      setCreating(false)
      setMode('position')
      await refreshSurveys(created.id)
      showOk('You are at the centre (6, 4) m. Walk, click your new spot on the map, and it measures automatically.')
    } catch (err) {
      showError(err)
    }
  }

  // A click on the map: either mark my position (and auto-measure) or place the router.
  async function handlePick(point) {
    if (mode === 'position') {
      if (measuring) {
        showError(new Error('A measurement is still running - wait for it to finish, then click your next spot.'))
        return
      }
      setSelected(point)
      if (autoMeasure) measureAt(point)
      return
    }
    try {
      setSurvey(await api.patch(`/surveys/${surveyId}`, { router: point }))
      showOk(`Router placed at (${point.x}, ${point.y}) m.`)
    } catch (err) {
      showError(err)
    }
  }

  // Real measurement: the backend takes `samples` readings, 1 s apart, at `point`.
  async function measureAt(point, id = surveyId) {
    setMeasuring(true)
    setNotice(null)
    try {
      const r = await api.post(`/surveys/${id}/measure`, { ...point, samples })
      showOk(`Saved ${r.rssi_mean} dBm ± ${r.rssi_std} at (${r.x}, ${r.y}) from ${r.samples.length} samples.`)
      await refreshReadings(id)
    } catch (err) {
      showError(err)
    } finally {
      setMeasuring(false)
    }
  }

  async function handleManual(rssi) {
    try {
      await api.post(`/surveys/${surveyId}/readings`, { ...selected, rssi })
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
  return (
    <div className="app">
      <header className="header">
        <h1>Wi-Fi Signal Mapper</h1>
        <div className="header-controls">
          <label htmlFor="survey-select" className="sr-only">Survey</label>
          <select id="survey-select" value={surveyId ?? ''} disabled={!surveys.length || measuring}
            onChange={(e) => { setCreating(false); setSurveyId(e.target.value) }}>
            {!surveys.length && <option value="">No surveys yet</option>}
            {surveys.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.width}×{s.height} m)</option>)}
          </select>
          <button className="primary" onClick={handleSurveyAroundMe} disabled={measuring}>Survey around me</button>
          <button onClick={() => setCreating(true)} disabled={measuring}>New survey</button>
        </div>
      </header>

      {backendError && <div className="banner error" role="alert">{backendError}</div>}
      {health?.db === 'memory' && (
        <div className="banner warn" role="status">
          <span>
            Database is in <strong>memory mode</strong> (Supabase not connected) — data is lost when the
            backend stops. Export CSV before closing.
          </span>
        </div>
      )}
      {notice && (
        <div className={`banner ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button className="icon" onClick={() => setNotice(null)} aria-label="Dismiss message">✕</button>
        </div>
      )}

      {creating ? (
        <main className="single">
          <NewSurveyForm onCreate={handleCreate} onCancel={() => setCreating(false)} canCancel={surveys.length > 0} />
        </main>
      ) : survey ? (
        <main className="layout">
          <section className="map-panel" aria-label="Floor map">
            <div className="toolbar">
              <div className="segmented" role="group" aria-label="Click mode">
                <button aria-pressed={mode === 'position'} onClick={() => setMode('position')}>Mark my position</button>
                <button aria-pressed={mode === 'router'} onClick={() => setMode('router')}>Place router</button>
              </div>
              <label className="check">
                <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
                Heatmap
              </label>
              <span className="muted small">{survey.width} × {survey.height} m</span>
            </div>
            <FloorMap survey={survey} readings={readings} map={map} showHeatmap={showHeatmap}
              mode={mode} selected={selected} live={live?.rssi ?? null} onSelect={setSelected} onPick={handlePick} />
            <p className="muted small">
              {mode === 'position'
                ? autoMeasure
                  ? `Walk to a spot and click it on the map - it measures for ${samples} s automatically. Arrow keys + Enter also work.`
                  : 'Click where you are standing, then press “Measure here”. Arrow keys move the marker.'
                : 'Click where the router is (Enter places it at the keyboard marker).'}
            </p>
            <Legend />
          </section>

          <aside className="side-panel">
            <SignalMeter paused={measuring} onReading={setLive} />
            <MeasurePanel selected={selected} measuring={measuring}
              samples={samples} onSamplesChange={setSamples}
              autoMeasure={autoMeasure} onAutoChange={setAutoMeasure}
              onMeasure={() => measureAt(selected)} onManual={handleManual} />
            <StatsPanel map={map} />
            <ReadingsList surveyId={surveyId} readings={readings}
              onDeleteReading={handleDeleteReading} onDeleteSurvey={handleDeleteSurvey} />
          </aside>
        </main>
      ) : (
        <main className="single"><p className="muted">Loading…</p></main>
      )}
    </div>
  )
}
