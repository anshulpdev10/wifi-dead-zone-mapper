// RoomsTab.jsx - the room-by-room survey (the main screen).
// No floor plan, no metres, no walking plan:
//   1. walk into a room and hold the laptop where you normally use it
//   2. tap the room's name (or type your own) and press Measure
//   3. the results rank every room and answer "extender needed? where?"
// The backend averages N fresh samples (1 per second) per spot; measuring a
// room again adds another spot to it (e.g. the bed and the desk).
import { useEffect, useState } from 'react'
import { BANDS, bandFor, DEAD_DBM, GOOD_DBM } from '../bands.js'
import PlacePicker from './PlacePicker.jsx'

const SAMPLE_OPTIONS = [5, 10, 15, 20, 30]
const SCALE_TOP = -30, SCALE_BOTTOM = -100      // bar length: -100 dBm = empty, -30 dBm = full
const STATUS_LABEL = { good: 'Good', fair: 'Fair', dead: 'Dead zone' }

const barPct = (dbm) => Math.max(2, Math.min(100, ((dbm - SCALE_BOTTOM) / (SCALE_TOP - SCALE_BOTTOM)) * 100))

function Progress({ seconds, room, onStop }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="progress" role="status">
      <div style={{ width: `${Math.min(100, (elapsed / seconds) * 100)}%` }} />
      <span className="small">
        Stay in <strong>{room}</strong> and hold still – don't walk until it says done… {Math.min(elapsed, seconds)} / {seconds} s
      </span>
      <button className="danger small-button" onClick={onStop}>■ Stop</button>
    </div>
  )
}

export default function RoomsTab({ result, busy, samples, onSamplesChange, voice, onVoiceChange,
  onMeasure, onStop, onDeleteRoom, exportHref, onDeleteSurvey }) {
  const [chosen, setChosen] = useState('')
  const measuring = busy === 'room'
  const rooms = result?.rooms || []

  function measure(event) {
    event.preventDefault()
    if (chosen) onMeasure(chosen)
  }

  const ext = result?.extender
  return (
    <div className="rooms">
      <section className="card" aria-labelledby="room-measure-title">
        <h2 id="room-measure-title">Measure a room</h2>
        <p className="small">
          Go to a room (classroom, lab, bedroom…), hold the laptop where you normally use it, pick the room
          and press <strong>Measure</strong>. Measure again in the same room to add another spot.
        </p>

        <PlacePicker value={chosen} onChange={setChosen} extra={rooms.map((r) => r.name)}
          disabled={measuring} idPrefix="room" />

        <form className="row" onSubmit={measure}>
          <label htmlFor="room-time" className="small">Time</label>
          <select id="room-time" value={samples} disabled={measuring} onChange={(e) => onSamplesChange(Number(e.target.value))}>
            {SAMPLE_OPTIONS.map((n) => <option key={n} value={n}>{n} s</option>)}
          </select>
          <button className="primary big" type="submit" disabled={!chosen || !!busy}>
            {measuring ? 'Measuring…' : chosen ? `Measure ${chosen}` : 'Pick a room first'}
          </button>
          <label className="check small">
            <input type="checkbox" checked={voice} onChange={(e) => onVoiceChange(e.target.checked)} />
            Speak the result
          </label>
        </form>
        {measuring && <Progress seconds={samples} room={chosen} onStop={onStop} />}
        <p className="muted small">
          If the signal changes a lot during the count (you walked into another room), nothing is saved and it
          asks you to measure again – so every room's number really comes from that room.
        </p>
      </section>

      <section className="card" aria-labelledby="room-results-title">
        <h2 id="room-results-title">
          Results {result?.preliminary && <span className="muted">(preliminary – measure more rooms)</span>}
        </h2>
        {!result?.ready ? <p className="muted">{result?.message || 'Loading…'}</p> : (
          <>
            <div className={`verdict ${ext.needed ? 'needed' : 'ok'}`}>
              <strong>{ext.needed ? '★ Extender required' : '✓ No extender needed'}</strong>
              <span>{ext.reason}</span>
              {result.extender_room && <span>Best place for it: <strong>{result.extender_room}</strong></span>}
            </div>
            {result.router_room && (
              <p className="small router-line">
                ▲ Your router is probably in <strong>{result.router_room}</strong> (or right next to it) – it has
                the strongest signal.
              </p>
            )}

            <ol className="room-list">
              {rooms.map((r) => {
                const color = bandFor(r.avg_dbm).color
                return (
                  <li key={r.name} className={r.status}>
                    <div className="room-head">
                      <strong>{r.name}</strong>
                      <span className="room-dbm">{r.avg_dbm} dBm</span>
                      <span className="tag" style={{ background: color }}>{STATUS_LABEL[r.status]}</span>
                      {result.router_room === r.name && <span className="tag router-tag">router?</span>}
                      {result.extender_room === r.name && <span className="tag ext-tag">extender here</span>}
                      <button className="icon" disabled={!!busy} onClick={() => onDeleteRoom(r.name)}
                        aria-label={`Delete all readings of ${r.name}`}>✕</button>
                    </div>
                    <div className="room-bar" aria-hidden="true">
                      <div style={{ width: `${barPct(r.avg_dbm)}%`, background: color }} />
                      <span className="mark" style={{ left: `${barPct(GOOD_DBM)}%` }} />
                      <span className="mark dead" style={{ left: `${barPct(DEAD_DBM)}%` }} />
                    </div>
                    <span className="muted small">
                      {r.spots} spot{r.spots > 1 ? 's' : ''}
                      {r.spots > 1 && ` · best ${r.best_dbm} · worst ${r.worst_dbm}`}
                      {r.unstable && ' · ⚠ unstable signal'}
                    </span>
                  </li>
                )
              })}
            </ol>
            <p className="muted small">
              Bar marks: −67 dBm (good for video calls) and −75 dBm (below = dead zone: drops, very slow).
              Colours: {BANDS.map((b) => b.name).join(' · ')}.
            </p>

            {result.advice.length > 0 && (
              <ul className="advice">{result.advice.map((tip) => <li key={tip}>{tip}</li>)}</ul>
            )}
          </>
        )}
        <div className="row">
          <a className="button" href={exportHref} download>Export CSV</a>
          <button className="danger" onClick={onDeleteSurvey} disabled={!!busy}>Delete survey</button>
        </div>
      </section>
    </div>
  )
}
