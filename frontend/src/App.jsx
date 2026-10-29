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
import { isPhone, requestSensorPermission, useStepTracker } from './useStepTracker.js'
import { bandFor } from './bands.js'
import { say, unlockAudio, beep } from './sound.js'
import AroundMeForm from './components/AroundMeForm.jsx'
import CalibrationPanel from './components/CalibrationPanel.jsx'
import FloorMap from './components/FloorMap.jsx'
import Legend from './components/Legend.jsx'
import MeasurePanel from './components/MeasurePanel.jsx'
import NetworksTab from './components/NetworksTab.jsx'
import QualityCard from './components/QualityCard.jsx'
import ReadingsList from './components/ReadingsList.jsx'
import RoomsTab from './components/RoomsTab.jsx'
import RouterCard from './components/RouterCard.jsx'
import SignalMeter from './components/SignalMeter.jsx'
import StatsPanel from './components/StatsPanel.jsx'
import WhatIfCard from './components/WhatIfCard.jsx'
import { downscaleImage } from './image.js'

const MODES = [
  ['track', 'Track my walk'],      // pointer = you; a reading every 2 s along your path
  ['measure', 'Tap to measure'],   // tap = measure there for N s (more accurate)
  ['router', 'Place router'],      // tap = router position
]
const TABS = [['rooms', 'Rooms'], ['map', 'Floor map'], ['networks', 'Networks']]
const TRACK_EVERY_MS = 2000
// Map readings older than this are from an earlier session (the dashboard opens on the
// newest survey): ask before drawing a new walk into that heatmap.
const SESSION_GAP_MS = 30 * 60 * 1000

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
  const [creating, setCreating] = useState(false)     // showing the "Survey around me" form?
  const [mode, setMode] = useState('track')
  const [tracking, setTracking] = useState(false)     // track mode running?
  const [trackCount, setTrackCount] = useState(0)
  const [trackError, setTrackError] = useState('')
  const [stepMode, setStepMode] = useState(isPhone)   // phone: move "you" by steps + compass
  const [facing, setFacing] = useState(0)            // degrees: 0 = facing → on the map at Start, 90 = ↓ …
  const [stepLength, setStepLength] = useState(0.7)  // metres per step
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [selected, setSelected] = useState(null)      // {x, y} in metres
  const [busy, setBusy] = useState(null)              // null | 'measure' | 'room'
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
  const trackAfterLoad = useRef(null)                 // new survey for a walk: {id, point} to start tracking at
  const selectedRef = useRef(null)                    // where "you" are, for the tracking timer
  selectedRef.current = selected
  const trackingRef = useRef(false)
  trackingRef.current = tracking

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

  // Track mode: every 2 s, save the newest live sample at "your" position.
  // Standing still, one reading per 6 s at the same spot is enough.
  useEffect(() => {
    if (!tracking) return
    let inFlight = false
    let last = null
    const timer = setInterval(async () => {
      const pos = selectedRef.current
      if (!pos || inFlight) return
      if (last && Math.hypot(pos.x - last.x, pos.y - last.y) < 0.3 && Date.now() - last.t < 6000) return
      inFlight = true
      try {
        const r = await api.post(`/surveys/${surveyIdRef.current}/track`, pos)
        last = { x: pos.x, y: pos.y, t: Date.now() }
        setTrackCount((c) => c + 1)
        setTrackError('')
        setLastAddedId(r.id)
        scheduleRefresh()
      } catch (err) {
        setTrackError(err.message)
      } finally {
        inFlight = false
      }
    }, TRACK_EVERY_MS)
    return () => clearInterval(timer)
  }, [tracking])

  // Tracking stops when you leave the floor map, change mode or switch survey.
  useEffect(() => { setTracking(false) }, [surveyId, tab, mode])

  // Step tracking: each step moves "you" one step length in the direction you
  // face. The first step's compass heading = the direction chosen in "I'm facing".
  const startHeading = useRef(null)
  const steps = useStepTracker(tracking && stepMode, (heading) => {
    if (startHeading.current == null) startHeading.current = heading
    const angle = ((heading - startHeading.current + facing) * Math.PI) / 180   // clockwise; map y points down
    const clamp = (v, max) => Math.round(Math.min(max, Math.max(0, v)) * 10) / 10
    setSelected((p) => p && {
      x: clamp(p.x + stepLength * Math.cos(angle), survey.width),
      y: clamp(p.y + stepLength * Math.sin(angle), survey.height),
    })
  })

  useEffect(() => {
    if (steps.status !== 'no-sensors') return
    setStepMode(false)
    showError(new Error('This device has no motion sensors - keep the pointer on where you are instead.'))
  }, [steps.status])

  async function toggleTracking() {
    if (tracking) {
      setTracking(false)
      showOk(`Tracking stopped – ${trackCount} reading(s) saved along your path.`)
      return
    }
    if (stepMode && !(await requestSensorPermission())) {
      showError(new Error('Motion sensors were not allowed - move your finger on the map instead.'))
      setStepMode(false)
    }
    const point = selected ?? { x: survey.width / 2, y: survey.height / 2 }
    try {
      if (await newSurveyIfOld((id) => { trackAfterLoad.current = { id, point } })) return  // load effect starts it
    } catch (err) {
      showError(err)
      return
    }
    setSelected(point)
    startTracking()
  }

  function startTracking() {
    startHeading.current = null
    setTrackCount(0); setTrackError(''); setWhatIfMode(false); setWhatIf(null)
    setTracking(true)
  }

  // Floor map: if this survey's last map reading is from an earlier session, ask
  // whether to start a new survey (same size, empty map) for this walk instead.
  // onCreated(id) runs before the new survey loads. Returns true if one was created.
  async function newSurveyIfOld(onCreated) {
    const last = Math.max(0, ...mapReadings.map((r) => Date.parse(r.time) || 0))
    if (!last || Date.now() - last < SESSION_GAP_MS) return false
    const when = new Date(last).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    if (!window.confirm(`“${survey.name}” already has ${mapReadings.length} map reading(s), the last one from ${when}.\n\n`
      + 'OK = start a new survey for this walk (empty map)\nCancel = add to this survey')) return false
    const name = `Survey ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
    const created = await api.post('/surveys', { name, width: survey.width, height: survey.height })
    onCreated(created.id)
    await refreshSurveys(created.id)
    showOk(`New survey “${name}” started – the old one is still in the survey list.`)
    return true
  }

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
        // A walk that asked for a new survey: start tracking where you were.
        if (trackAfterLoad.current?.id === surveyId) {
          setSelected(trackAfterLoad.current.point)
          trackAfterLoad.current = null
          startTracking()
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
      if (list.length === 0) setCreating(true)
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
  // wait and refresh once (longer while tracking, which saves a point every 2 s).
  function scheduleRefresh() {
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => refreshReadings(), trackingRef.current ? 1200 : 250)
  }

  // ------------------------------------------------------------ actions
  // New survey: no form - places are named with the room buttons anyway.
  async function handleNewSurvey() {
    try {
      const name = `Survey ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
      const created = await api.post('/surveys', { name, width: 12, height: 8 })
      setCreating(false)
      setTab((t) => (t === 'networks' ? 'rooms' : t))
      await refreshSurveys(created.id)
      showOk('New survey started. Rooms: pick where you are and press Measure. Floor map: Start tracking.')
    } catch (err) {
      showError(err)
    }
  }

  async function setRouter(point) {
    try {
      setSurvey(await api.patch(`/surveys/${surveyId}`, { router: point }))
      showOk(point ? `Router set at ${describePosition(point)}.` : 'Router removed.')
      scheduleRefresh()                              // calibration depends on the router
    } catch (err) {
      showError(err)
    }
  }

  async function handlePlanFile(file) {
    if (!file) return
    try {
      const plan = await downscaleImage(file)
      setSurvey(await api.patch(`/surveys/${surveyId}`, { plan }))
      showOk('Floor plan added under the map.')
    } catch (err) {
      showError(err)
    }
  }

  // "Survey around me": a range x range m map with the user in the centre.
  // The first reading is taken straight away at the centre (see the load effect).
  async function handleAroundMe(place, range) {
    unlockAudio()                                       // allowed: called from a click
    const created = await api.post('/surveys', { name: `${place} – ${range} m around me`, width: range, height: range })
    startAt.current = { id: created.id, point: { x: range / 2, y: range / 2 } }
    setCreating(false)
    setTab('map')
    await refreshSurveys(created.id)
    setMode('track')
    showOk(`Measuring where you stand (the centre) for ${samples} s… Then press “Start tracking” and walk.`)
  }

  // A tap on the map - what happens depends on the mode (track mode: the pointer is you).
  async function handlePick(point) {
    if (mode === 'router') { setRouter(point); return }
    if (mode === 'track') { setSelected(point); return }
    if (busy) {
      showError(new Error('A measurement is still running - wait for it to finish, then tap your next spot.'))
      return
    }
    setSelected(point)
    if (autoMeasure) measureOnMap(point)
  }

  // Tap to measure, with the same "earlier session?" check as tracking.
  async function measureOnMap(point) {
    try {
      if (await newSurveyIfOld((id) => { startAt.current = { id, point } })) return  // load effect measures there
    } catch (err) {
      showError(err)
      return
    }
    measureAt(point)
  }

  // Shared by every kind of measurement: run the request, show + speak the result, refresh.
  // Stop button (or, on a phone, walking off during the count): the backend
  // ends the measurement without saving anything.
  const stopReason = useRef(null)
  async function stopMeasuring(reason = 'user') {
    stopReason.current = reason
    try {
      await api.post('/measure/cancel')
    } catch (err) {
      showError(err)
    }
  }
  const walkSteps = useRef(0)
  useStepTracker(isPhone() && !tracking && (busy === 'room' || busy === 'measure'), () => {
    walkSteps.current += 1
    if (walkSteps.current === 2 && !stopReason.current) stopMeasuring('walked')   // 2 steps, not one jolt
  })

  async function record(kind, request, where) {
    setBusy(kind)
    setNotice(null)
    stopReason.current = null
    walkSteps.current = 0
    if (isPhone()) requestSensorPermission()       // iOS only asks from a button press
    try {
      const r = await request()
      setLastAddedId(r.id)
      const label = where(r)
      showOk(`Saved ${r.rssi_mean} dBm ± ${r.rssi_std} ${label} (${r.samples.length} samples).`)
      beep(880, 0.15)
      speak(`${r.room ? r.room + ': ' : ''}${Math.round(r.rssi_mean)} dBm, ${bandFor(r.rssi_mean).name}. Done, you can move.`)
      await refreshReadings()
      return r
    } catch (err) {
      if (stopReason.current === 'user') showOk('Stopped – nothing was saved.')
      else if (stopReason.current === 'walked') {
        showError(new Error('You started walking, so the measurement was stopped and nothing was saved. '
          + 'Stand still in the room and measure again.'))
        speak('You moved. Stand still and measure again.')
      } else {
        showError(err)
        if (err.message.includes('you probably moved')) speak('The signal changed, you probably moved. Stand still and measure again.')
      }
      return null
    } finally {
      setBusy(null)
    }
  }

  // Measure: the backend averages `samples` fresh samples (1 per second).
  const measureAt = (point) => record('measure',
    () => api.post(`/surveys/${surveyIdRef.current}/measure`, { ...point, samples }),
    (r) => `at ${describePosition(r)}`)
  // Room-by-room: average `samples` samples and file them under the room's name.
  const measureRoom = (room) => {
    unlockAudio()
    speak(`Measuring ${room}. Stand still for ${samples} seconds.`)
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
    track: tracking
      ? (stepMode
        ? 'Tracking your steps: just walk. Tap the map if the dot drifts from where you really are.'
        : 'Tracking: keep the pointer (or your finger) on where you are as you walk. A reading is saved every 2 s.')
      : (stepMode
        ? 'Tap where you stand, choose the way you face, press “Start tracking” and walk – the dot follows your steps.'
        : 'Press “Start tracking”, then keep the pointer on where you are as you walk – the heatmap builds along your path.'),
    measure: autoMeasure
      ? `Walk, stop, and tap where you are now - it measures there for ${samples} s. Roughly is fine.`
      : 'Tap where you are standing, then press “Measure here”. Arrow keys move the marker.',
    router: 'Tap where the router is (or accept the “router?” estimate in the side panel).',
  }[mode]
  const exportHref = `/api/surveys/${surveyId}/export.csv`

  let content
  if (tab === 'networks') {
    content = <main className="single wide"><NetworksTab live={stream.latest} /></main>
  } else if (creating) {
    content = (
      <main className="single">
        <AroundMeForm onStart={handleAroundMe} onCancel={() => setCreating(false)} canCancel={surveys.length > 0} />
      </main>
    )
  } else if (!survey) {
    content = <main className="single"><p className="muted">Loading…</p></main>
  } else if (tab === 'rooms') {
    content = (
      <main className="layout">
        <RoomsTab key={surveyId} result={rooms} busy={busy} samples={samples} onSamplesChange={setSamples}
          voice={voice} onVoiceChange={setVoice} onMeasure={measureRoom} onStop={() => stopMeasuring()}
          onDeleteRoom={handleDeleteRoom}
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
            <label className="button file-button">
              {survey.plan ? 'Change floor plan' : 'Add floor plan'}
              <input type="file" accept="image/*" className="sr-only"
                onChange={(e) => { handlePlanFile(e.target.files[0]); e.target.value = '' }} />
            </label>
            {busy && <span className="busy-tag" role="status">Measuring…</span>}
            {tracking && <span className="busy-tag tracking-tag" role="status">● Tracking · {trackCount}</span>}
          </div>
          <FloorMap survey={survey} readings={mapReadings} map={map} showHeatmap={showHeatmap}
            mode={mode} selected={selected} live={stream.latest?.rssi ?? null} tracking={tracking}
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
            onMeasure={() => measureOnMap(selected)} onManual={handleManual} onStop={() => stopMeasuring()}
            tracking={tracking} trackCount={trackCount} trackError={trackError} onTrackToggle={toggleTracking}
            stepMode={stepMode} onStepModeChange={setStepMode} stepStatus={steps.status} stepCount={steps.steps}
            facing={facing} onFacingChange={setFacing} stepLength={stepLength} onStepLengthChange={setStepLength} />
          <RouterCard estimate={map?.router_estimate} router={survey.router} busy={!!busy}
            onUse={setRouter} onPlace={() => setMode('router')} onRemove={() => setRouter(null)} />
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
          <button className="primary" onClick={() => { setCreating(true); setTab((t) => (t === 'networks' ? 'map' : t)) }}
            disabled={!!busy || tracking}>Survey around me</button>
          <button onClick={handleNewSurvey} disabled={!!busy || tracking}>New survey</button>
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
