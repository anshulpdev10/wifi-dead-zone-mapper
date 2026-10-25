// App.jsx - the dashboard. Holds all shared state and talks to the backend;
// the components in ./components only display data and report user actions.
//
// Layout:  top bar  (survey dropdown, Survey around me, New survey,
//                    mode: Measure / Walk / Place router, Live indicator)
//          tabs     Survey | Networks
//          Survey:  [ floor map + toolbar + legend ]
//                   [ side panel: guide, live meter, measure, connection quality,
//                     results, path-loss calibration, readings ]
//          Networks: nearby networks table + channel charts
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { describePosition, guideStatus } from './guide.js'
import { useLiveStream } from './useLiveStream.js'
import { useAutoSurvey } from './useAutoSurvey.js'
import { say } from './sound.js'
import CalibrationPanel from './components/CalibrationPanel.jsx'
import FloorMap from './components/FloorMap.jsx'
import GuidePanel from './components/GuidePanel.jsx'
import Legend from './components/Legend.jsx'
import MeasurePanel from './components/MeasurePanel.jsx'
import NetworksTab from './components/NetworksTab.jsx'
import NewSurveyForm from './components/NewSurveyForm.jsx'
import QualityCard from './components/QualityCard.jsx'
import ReadingsList from './components/ReadingsList.jsx'
import SignalMeter from './components/SignalMeter.jsx'
import StatsPanel from './components/StatsPanel.jsx'
import WhatIfCard from './components/WhatIfCard.jsx'

const MODES = [
  ['measure', 'Measure'],      // click = set position (+ auto-measure N s)
  ['walk', 'Walk'],            // click = quick 3-sample reading, saved at once
  ['router', 'Place router'],  // click = router position
]

export default function App() {
  const [health, setHealth] = useState(null)          // {db: "supabase" | "memory", ...}
  const [backendError, setBackendError] = useState('')
  const [tab, setTab] = useState('survey')            // 'survey' | 'networks'
  const [surveys, setSurveys] = useState([])          // list for the dropdown
  const [surveyId, setSurveyId] = useState(null)      // selected survey
  const [survey, setSurvey] = useState(null)          // full survey (plan, router)
  const [readings, setReadings] = useState([])
  const [map, setMap] = useState(null)                // result of /map
  const [calibration, setCalibration] = useState(null) // result of /calibration
  const [creating, setCreating] = useState(false)     // showing the New survey form?
  const [mode, setMode] = useState('measure')
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [selected, setSelected] = useState(null)      // {x, y} in metres
  const [busy, setBusy] = useState(null)              // null | 'measure' | 'walk'
  const [samples, setSamples] = useState(10)          // measurement time: 1 sample per second
  const [autoMeasure, setAutoMeasure] = useState(true) // Measure mode: click = measure at once
  const [lastAddedId, setLastAddedId] = useState(null) // newest point pulses on the map
  const [notice, setNotice] = useState(null)          // {kind: 'ok' | 'error', text}
  const [skipped, setSkipped] = useState([])          // guided target numbers the user skipped
  const [walkSeconds, setWalkSeconds] = useState(10)  // hands-free: time to walk to the next point
  const [voice, setVoice] = useState(true)            // hands-free: speak instructions
  const [whatIfMode, setWhatIfMode] = useState(false)
  const [whatIf, setWhatIf] = useState(null)          // {router, result} or {router, error}
  const surveyIdRef = useRef(null)
  surveyIdRef.current = surveyId
  const refreshTimer = useRef(null)
  const whatIfBusy = useRef(false)                    // one prediction request at a time
  const whatIfNext = useRef(null)                     // latest drag position while busy
  const mapRef = useRef(null)
  mapRef.current = map

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

  // Guided 10-point survey: which targets are done, and where to go next.
  const guide = useMemo(
    () => (survey ? guideStatus(survey.width, survey.height, readings, skipped) : null),
    [survey, readings, skipped]
  )
  // Readings the calibration flags as "obstructed" get a warning ring on the map.
  const obstructedIds = useMemo(
    () => new Set((calibration?.points || []).filter((p) => p.obstructed).map((p) => p.id)),
    [calibration]
  )

  // Hands-free guided survey: speaks the next target, counts down, measures, repeats.
  const auto = useAutoSurvey({
    guide, setup: survey?.setup, walkSeconds, voice,
    measurePoint: (point) => { setSelected(point); return measureAt(point) },
    onSkip: (n) => setSkipped((list) => [...list, n]),
    onComplete: () => {
      const ext = mapRef.current?.extender
      const text = 'Survey complete. ' + (ext ? (ext.needed ? 'An extender is required. ' : 'No extender is needed. ') + ext.reason : '')
      showOk(text)
      if (voice) say(text)
    },
  })

  // Space = "I'm here, measure now" while the hands-free survey is running.
  // Buttons are NOT skipped: after clicking "Start hands-free" the focus stays on
  // that button (now "Pause"), and the browser would otherwise press it on Space.
  // keyup is blocked too, because buttons are activated on Space keyup.
  useEffect(() => {
    if (!auto.running) return
    const isTyping = (e) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)
    const onKeyDown = (e) => {
      if (e.code !== 'Space' || isTyping(e)) return
      e.preventDefault()
      if (!e.repeat) auto.measureNow()
    }
    const onKeyUp = (e) => { if (e.code === 'Space' && !isTyping(e)) e.preventDefault() }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [auto.running, auto.phase])

  // Switching survey stops a hands-free run.
  useEffect(() => { if (auto.running) auto.pause() }, [surveyId])

  const showError = (err) => setNotice({ kind: 'error', text: err.message })
  const showOk = (text) => setNotice({ kind: 'ok', text })

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

  // Success messages disappear after 4 seconds; errors stay until dismissed.
  useEffect(() => {
    if (notice?.kind !== 'ok') return
    const timer = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(timer)
  }, [notice])

  // Whenever the selected survey changes, load its details, readings, map, calibration.
  useEffect(() => {
    setSurvey(null); setReadings([]); setMap(null); setCalibration(null)
    setSelected(null); setSkipped([]); setWhatIfMode(false); setWhatIf(null)
    if (!surveyId) return
    let active = true
    Promise.all([
      api.get(`/surveys/${surveyId}`),
      api.get(`/surveys/${surveyId}/readings`),
      api.get(`/surveys/${surveyId}/map`),
      api.get(`/surveys/${surveyId}/calibration`),
    ])
      .then(([s, r, m, c]) => { if (active) { setSurvey(s); setReadings(r); setMap(m); setCalibration(c) } })
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
      if (list.length === 0) setCreating(true)
    } catch (err) {
      setBackendError(err.message)
    }
  }

  // Reload readings, heatmap and calibration after any change to the readings.
  async function refreshReadings(id = surveyIdRef.current) {
    if (!id) return
    try {
      const [r, m, c] = await Promise.all([
        api.get(`/surveys/${id}/readings`),
        api.get(`/surveys/${id}/map`),
        api.get(`/surveys/${id}/calibration`),
      ])
      if (id !== surveyIdRef.current) return        // user switched survey meanwhile
      setReadings(r); setMap(m); setCalibration(c)
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
    setCreating(false)
    await refreshSurveys(created.id)
    showOk(`Survey “${created.name}” created. Walk to point 1 and press “I'm here – measure”.`)
  }

  // "Survey around me": a 12 x 8 m area around where I stand, surveyed with the
  // guided 10 points. (Browser GPS/geolocation is only accurate to tens of
  // metres indoors, so positions inside the house come from the map.)
  async function handleSurveyAroundMe() {
    try {
      const name = `Around me ${new Date().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}`
      const created = await api.post('/surveys', { name, width: 12, height: 8 })
      setCreating(false)
      setMode('measure')
      setTab('survey')
      await refreshSurveys(created.id)
      showOk('12 × 8 m area created. Walk to point 1 and press “I\'m here – measure”.')
    } catch (err) {
      showError(err)
    }
  }

  // A click on the map - what happens depends on the mode.
  async function handlePick(point) {
    if (mode === 'router') {
      try {
        setSurvey(await api.patch(`/surveys/${surveyId}`, { router: point }))
        showOk(`Router placed at ${describePosition(point, survey.setup)}.`)
        scheduleRefresh()                            // calibration depends on the router
      } catch (err) {
        showError(err)
      }
      return
    }
    if (busy) {
      showError(new Error(busy === 'walk'
        ? 'Still recording the previous spot (about 3 s) - click again in a moment.'
        : 'A measurement is still running - wait for it to finish, then click your next spot.'))
      return
    }
    setSelected(point)
    if (auto.running) return                       // hands-free decides when to measure
    if (mode === 'walk') walkAt(point)
    else if (autoMeasure) measureAt(point)
  }

  // Shared by Measure and Walk: run the request, show the result, refresh.
  // Returns the saved reading, or null if it failed (used by hands-free mode).
  async function record(kind, request) {
    setBusy(kind)
    setNotice(null)
    try {
      const r = await request()
      setLastAddedId(r.id)
      showOk(`Saved ${r.rssi_mean} dBm ± ${r.rssi_std} at ${describePosition(r, survey?.setup)} (${r.samples.length} samples).`)
      await refreshReadings()
      return r
    } catch (err) {
      showError(err)
      return null
    } finally {
      setBusy(null)
    }
  }

  // Room directions (corner / wall / step length) for the guided survey.
  async function handleSaveSetup(setup) {
    setSurvey(await api.patch(`/surveys/${surveyId}`, { setup }))   // errors shown by the form
    showOk('Room directions saved. Print the placement sheet or press “Start hands-free”.')
  }

  // Measure: the backend averages `samples` fresh samples (1 per second).
  const measureAt = (point) => record('measure', () => api.post(`/surveys/${surveyId}/measure`, { ...point, samples }))
  // Walk: quick 3-sample reading, saved immediately.
  const walkAt = (point) => record('walk', () => api.post(`/surveys/${surveyId}/walk`, point))

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
      showOk(`Router set to ${describePosition(whatIf.router, survey.setup)}. Re-survey to confirm the prediction.`)
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
      ? `Follow the numbered targets, or click any spot - it measures for ${samples} s automatically. Arrow keys + Enter also work.`
      : 'Click where you are standing, then press “Measure here”. Arrow keys move the marker.',
    walk: 'Walk mode: click your spot each time you stop - a quick 3-sample reading (~3 s) is saved and the map redraws.',
    router: 'Click where the router is (Enter places it at the keyboard marker).',
  }[mode]

  return (
    <div className="app">
      <header className="header">
        <h1>Wi-Fi Signal Mapper</h1>
        <div className="header-controls">
          <label htmlFor="survey-select" className="sr-only">Survey</label>
          <select id="survey-select" value={surveyId ?? ''} disabled={!surveys.length || !!busy}
            onChange={(e) => { setCreating(false); setSurveyId(e.target.value) }}>
            {!surveys.length && <option value="">No surveys yet</option>}
            {surveys.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.width}×{s.height} m)</option>)}
          </select>
          <button className="primary" onClick={handleSurveyAroundMe} disabled={!!busy}>Survey around me</button>
          <button onClick={() => setCreating(true)} disabled={!!busy}>New survey</button>
          <div className="segmented" role="group" aria-label="Map click mode">
            {MODES.map(([key, label]) => (
              <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>
            ))}
          </div>
          <span className={`live-status ${stream.status}`} role="status" aria-live="polite">
            <span className="dot" aria-hidden="true" />{statusLabel}
          </span>
        </div>
      </header>

      <nav className="tabs" role="tablist" aria-label="Views">
        {[['survey', 'Survey'], ['networks', 'Networks']].map(([key, label]) => (
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
      {notice && (
        <div className={`banner ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          <span>{notice.text}</span>
          <button className="icon" onClick={() => setNotice(null)} aria-label="Dismiss message">✕</button>
        </div>
      )}

      {tab === 'networks' ? (
        <main className="single wide"><NetworksTab live={stream.latest} /></main>
      ) : creating ? (
        <main className="single">
          <NewSurveyForm onCreate={handleCreate} onCancel={() => setCreating(false)} canCancel={surveys.length > 0} />
        </main>
      ) : survey ? (
        <main className="layout">
          <section className="map-panel" aria-label="Floor map">
            <div className="toolbar">
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
              {busy &&<span className="busy-tag" role="status">{busy === 'walk' ? 'Recording spot…' : 'Measuring…'}</span>}
            </div>
            <FloorMap survey={survey} readings={readings} map={map} showHeatmap={showHeatmap}
              mode={mode} selected={selected} live={stream.latest?.rssi ?? null} guide={guide}
              obstructedIds={obstructedIds} lastAddedId={lastAddedId}
              whatIfMode={whatIfMode} whatIf={whatIf} onWhatIf={handleWhatIf}
              onSelect={setSelected} onPick={handlePick} />
            <p className="muted small">
              {hint}{' '}
              {survey.setup
                ? `Map top-left = ${survey.setup.corner}; top edge = ${survey.setup.wall}.`
                : 'Set the room directions in the Guide panel so the map matches your room.'}
            </p>
            <Legend />
          </section>

          <aside className="side-panel">
            <GuidePanel guide={guide} setup={survey.setup} auto={auto} measuring={!!busy} samples={samples}
              walkSeconds={walkSeconds} onWalkSecondsChange={setWalkSeconds} voice={voice} onVoiceChange={setVoice}
              onMeasurePoint={(p) => { const point = { x: p.x, y: p.y }; setSelected(point); measureAt(point) }}
              onSkip={(n) => setSkipped((list) => [...list, n])}
              onResetSkips={() => setSkipped([])} onSaveSetup={handleSaveSetup}
              onRedo={handleDeleteReading} />
            <SignalMeter samples={stream.samples} latest={stream.latest} status={stream.status} />
            <MeasurePanel mode={mode} selected={selected} measuring={!!busy}
              samples={samples} onSamplesChange={setSamples}
              autoMeasure={autoMeasure} onAutoChange={setAutoMeasure}
              onMeasure={() => measureAt(selected)} onManual={handleManual} />
            <QualityCard latest={stream.latest} />
            <StatsPanel map={map} guideComplete={guide.complete} setup={survey.setup} />
            <CalibrationPanel calibration={calibration} />
            <WhatIfCard calibration={calibration} whatIfMode={whatIfMode} whatIf={whatIf} current={map} setup={survey.setup}
              onToggle={(on) => { setWhatIfMode(on); if (!on) setWhatIf(null) }} onApply={applyWhatIf} />
            <ReadingsList surveyId={surveyId} readings={readings} obstructedIds={obstructedIds}
              onDeleteReading={handleDeleteReading} onDeleteSurvey={handleDeleteSurvey} />
          </aside>
        </main>
      ) : (
        <main className="single"><p className="muted">Loading…</p></main>
      )}
    </div>
  )
}
