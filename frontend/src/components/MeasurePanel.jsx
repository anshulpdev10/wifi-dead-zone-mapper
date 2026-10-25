// MeasurePanel.jsx - how readings are taken on the floor map:
//   Track   : Start tracking, then move the pointer (mouse, or your finger on the
//             phone dashboard) to where you are as you walk. A reading is saved
//             every 2 s at that spot - the heatmap builds along your path.
//   Measure : tap a spot -> the backend averages N samples there (more accurate).
//   Manual  : type a dBm value (e.g. from a phone app) for the marked position.
import { useEffect, useState } from 'react'

const SAMPLE_OPTIONS = [3, 5, 10, 15, 20, 30]   // 1 sample per second

export default function MeasurePanel({ mode, selected, measuring, samples, onSamplesChange,
  autoMeasure, onAutoChange, onMeasure, onManual, tracking, trackCount, trackError, onTrackToggle }) {
  const [manualRssi, setManualRssi] = useState('')
  const [elapsed, setElapsed] = useState(0)

  // Count seconds while a measurement is running (just for the progress bar).
  useEffect(() => {
    if (!measuring) return
    setElapsed(0)
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(timer)
  }, [measuring])

  async function submitManual(event) {
    event.preventDefault()
    if (await onManual(Number(manualRssi))) setManualRssi('')
  }

  const position = selected ? `(${selected.x.toFixed(1)}, ${selected.y.toFixed(1)}) m` : 'none yet'

  return (
    <section className="card" aria-labelledby="measure-title">
      <h2 id="measure-title">{mode === 'track' ? 'Track my walk' : 'Measure'}</h2>

      {mode === 'track' && <>
        <button className={`big ${tracking ? 'danger' : 'primary'}`} onClick={onTrackToggle} disabled={measuring && !tracking}>
          {tracking ? '■ Stop tracking' : '▶ Start tracking'}
        </button>
        <p className="small">
          {tracking
            ? <>Keep the pointer on <strong>where you are</strong> as you walk (mouse over the map, or your finger on the
              phone). A reading is saved every 2 s – <strong>{trackCount}</strong> so far.</>
            : <>Carry the laptop. Press Start, then keep the pointer on your position as you walk – no clicking needed.
              Tip: open the dashboard on your phone (<code>npm run dev:lan</code>) and drag your finger along as you go.</>}
        </p>
        {trackError && <p className="error small" role="alert">{trackError}</p>}
        <p className="small">You: <strong>{position}</strong></p>
      </>}

      {mode === 'measure' && <>
        <p className="small">Position: <strong>{position}</strong></p>
        <div className="row">
          <label htmlFor="samples">Time</label>
          <select id="samples" value={samples} disabled={measuring}
            onChange={(e) => onSamplesChange(Number(e.target.value))}>
            {SAMPLE_OPTIONS.map((n) => <option key={n} value={n}>{n} s ({n} samples)</option>)}
          </select>
          <button className="primary" disabled={!selected || measuring} onClick={() => onMeasure()}>
            {measuring ? 'Measuring…' : 'Measure here'}
          </button>
        </div>
        <label className="check auto">
          <input type="checkbox" checked={autoMeasure} onChange={(e) => onAutoChange(e.target.checked)} />
          Measure as soon as I tap the map
        </label>
        {measuring && (
          <div className="progress" role="status">
            <div style={{ width: `${Math.min(100, (elapsed / samples) * 100)}%` }} />
            <span className="small">Hold still… {Math.min(elapsed, samples)} / {samples} s</span>
          </div>
        )}
      </>}

      {mode === 'router' && <p className="small">Tap where the router is on the map.</p>}

      {mode !== 'track' && (
        <form className="row" onSubmit={submitManual}>
          <label htmlFor="manual">Manual dBm</label>
          <input id="manual" type="number" min="-110" max="-10" step="0.1" placeholder="-65"
            required value={manualRssi} onChange={(e) => setManualRssi(e.target.value)} />
          <button type="submit" disabled={!selected || measuring}>Add</button>
        </form>
      )}
    </section>
  )
}
