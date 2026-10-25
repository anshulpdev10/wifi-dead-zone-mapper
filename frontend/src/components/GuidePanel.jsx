// GuidePanel.jsx - the guided 10-point survey.
//  1. Room directions (once): which real corner is (0, 0) and which wall runs
//     along the top, so every target can be described in the user's own words.
//  2. Placement sheet: the 10 spots as directions, to print and mark the floor
//     with numbered paper notes before walking.
//  3. Hands-free mode: the laptop speaks the next target, counts down while you
//     walk, measures, announces the result and moves on. Space = measure now.
//  Without hands-free: "I'm here – measure" for one point at a time.
import { useState } from 'react'
import { directions, GUIDE_POINTS } from '../guide.js'
import SetupForm from './SetupForm.jsx'

const WALK_OPTIONS = [5, 8, 10, 15, 20, 30]

// Open the placement sheet as its own simple page and print it.
function printSheet(points, setup) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const intro = setup
    ? `<p>Start in the <b>${esc(setup.corner)}</b>. "Along" = along the <b>${esc(setup.wall)}</b>; "into the room" = straight out from it.</p>`
    : ''
  const items = points.map((p) => `<li>${esc(directions(p, setup))}</li>`).join('')
  const win = window.open('', '_blank', 'width=700,height=800')
  if (!win) return
  win.document.write(`<!doctype html><title>Wi-Fi survey placement sheet</title>
    <style>body{font:16px system-ui,sans-serif;margin:32px}li{margin:10px 0}</style>
    <h1>Wi-Fi survey – where to put the 10 notes</h1>${intro}<ol>${items}</ol>
    <p>Put a numbered paper note on the floor at each spot, then run the hands-free survey.</p>`)
  win.document.close()
  win.focus()
  win.print()
}

export default function GuidePanel({ guide, setup, auto, measuring, samples, walkSeconds, onWalkSecondsChange,
  voice, onVoiceChange, onMeasurePoint, onSkip, onResetSkips, onSaveSetup, onRedo }) {
  const [editing, setEditing] = useState(false)
  const [setupSkipped, setSetupSkipped] = useState(false)
  const { next, doneCount, points } = guide
  const skippedCount = points.filter((p) => p.skipped && !p.done).length
  const showSetup = editing || (!setup && !setupSkipped)

  async function saveSetup(value) {
    await onSaveSetup(value)
    setEditing(false)
  }

  return (
    <section className="card guide" aria-labelledby="guide-title">
      <h2 id="guide-title">Guided survey · {doneCount} / {GUIDE_POINTS} points</h2>
      <div className="progress-track" aria-hidden="true">
        <div style={{ width: `${(doneCount / GUIDE_POINTS) * 100}%` }} />
      </div>

      {/* 1. Room directions */}
      {showSetup ? (
        <>
          <h3>Step 1 · Line the map up with your room</h3>
          <SetupForm initial={setup} onSave={saveSetup}
            onCancel={editing ? () => setEditing(false) : () => setSetupSkipped(true)}
            saveLabel={editing ? 'Save directions' : 'Save and continue'} />
        </>
      ) : (
        <p className="small room-line">
          {setup
            ? <>Start corner: <strong>{setup.corner}</strong> · top wall: <strong>{setup.wall}</strong>
              {setup.step_m && <> · step {setup.step_m} m</>}</>
            : 'Directions use the map\'s left / top wall.'}
          {' '}<button className="link inline" onClick={() => setEditing(true)}>{setup ? 'Edit' : 'Set room directions'}</button>
        </p>
      )}

      {!showSetup && (next ? (
        <>
          {/* 2. Live status of the hands-free run, or the next target */}
          {auto.running && auto.target ? (
            <div className={`auto-status ${auto.phase}`} role="status" aria-live="assertive">
              <span className="badge">{auto.target.n}</span>
              {auto.phase === 'announce' && <strong>Point {auto.target.n} – listen for directions</strong>}
              {auto.phase === 'walk' && <><strong>Walk to point {auto.target.n}</strong>
                <span className="countdown">{auto.countdown} s</span></>}
              {auto.phase === 'measure' && <strong>Measuring point {auto.target.n} – hold still…</strong>}
              <p className="small">{directions(auto.target, setup)}</p>
              {(auto.phase === 'walk' || auto.phase === 'announce') &&
                <p className="muted small">Press <kbd>Space</kbd> when you are there to measure now.</p>}
            </div>
          ) : (
            <p className="guide-target">
              Next: point <span className="badge">{next.n}</span>
              <strong>{directions(next, setup)}</strong>
            </p>
          )}

          {/* 3. Hands-free controls */}
          <div className="row">
            {auto.running
              ? <button className="primary" onClick={auto.pause}>Pause</button>
              : <button className="primary" disabled={measuring} onClick={auto.start}>▶ Start hands-free</button>}
            {auto.running
              ? <button onClick={auto.skip} disabled={auto.phase === 'measure'}>Skip point</button>
              : <>
                <button disabled={measuring} onClick={() => onMeasurePoint(next)}>I'm here – measure {samples} s</button>
                <button disabled={measuring} onClick={() => onSkip(next.n)}>Skip</button>
              </>}
          </div>
          <div className="row tight">
            <label htmlFor="walk-time" className="small">Walking time</label>
            <select id="walk-time" value={walkSeconds} disabled={auto.running}
              onChange={(e) => onWalkSecondsChange(Number(e.target.value))}>
              {WALK_OPTIONS.map((s) => <option key={s} value={s}>{s} s</option>)}
            </select>
            <label className="check small">
              <input type="checkbox" checked={voice} onChange={(e) => onVoiceChange(e.target.checked)} />
              Voice
            </label>
            <span className="muted small">Measuring: {samples} s each</span>
          </div>
        </>
      ) : (
        <p className="guide-done">
          {doneCount === GUIDE_POINTS ? 'All 10 points measured ✓' : `Guided points finished (${skippedCount} skipped) ✓`}
          {' '}— the heatmap, dead zones and extender advice below are your results.
          {' '}Add extra points anywhere the map looks uncertain.
        </p>
      ))}

      {/* Last result + redo when the signal wobbled */}
      {auto.last && (
        <p className={`small last-result ${auto.last.unstable ? 'unstable' : ''}`}>
          Point {auto.last.n}: <strong>{Math.round(auto.last.reading.rssi_mean)} dBm</strong> ± {auto.last.reading.rssi_std}
          {auto.last.unstable && <> – unstable signal.{' '}
            <button className="link inline" disabled={measuring} onClick={() => onRedo(auto.last.reading.id)}>Redo point {auto.last.n}</button></>}
        </p>
      )}

      {skippedCount > 0 && (
        <button className="link" onClick={onResetSkips}>Bring back {skippedCount} skipped point(s)</button>
      )}

      {/* 4. Placement sheet: mark the floor once, then walk note to note */}
      {!showSetup && (
        <details className="placement">
          <summary>Placement sheet – mark the 10 spots on the floor</summary>
          <div className="print-sheet">
            <h3>Wi-Fi survey – where to put the 10 notes</h3>
            {setup && <p className="small">Start in the <strong>{setup.corner}</strong>. “Along” = along the <strong>{setup.wall}</strong>; “into the room” = straight out from it.</p>}
            <ol className="sheet-list">
              {points.map((p) => <li key={p.n} className={p.done ? 'done' : ''}>{directions(p, setup)}{p.done && ' ✓'}</li>)}
            </ol>
          </div>
          <button onClick={() => printSheet(points, setup)}>Print sheet</button>
        </details>
      )}
    </section>
  )
}
