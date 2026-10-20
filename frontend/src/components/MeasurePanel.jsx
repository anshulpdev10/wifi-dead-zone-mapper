// MeasurePanel.jsx - "Measure here" (backend averages N real samples taken 1 s
// apart), the auto-measure switch, and manual entry (type a dBm value, e.g.
// from a phone app). All of them use the position currently marked on the map.
//
// Auto-measure ON: clicking a position on the map starts a measurement there
// immediately, for the time chosen in the dropdown - no button press needed.
import { useEffect, useState } from 'react'

const SAMPLE_OPTIONS = [3, 5, 10, 15, 20, 30]   // 1 sample per second

export default function MeasurePanel({ mode, selected, measuring, samples, onSamplesChange,
  autoMeasure, onAutoChange, onMeasure, onManual }) {
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

  const position = selected ? `(${selected.x.toFixed(1)}, ${selected.y.toFixed(1)}) m` : 'none - click the map'

  return (
    <section className="card" aria-labelledby="measure-title">
      <h2 id="measure-title">Measure</h2>
      <p className="small">Position: <strong>{position}</strong></p>

      {mode === 'walk' && (
        <p className="small walk-note">
          Walk mode is on: every click on the map saves a quick 3-sample reading (~3 s).
          Switch to <strong>Measure</strong> for longer, more accurate readings.
        </p>
      )}

      {mode !== 'walk' && <>
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
        Auto-measure when I click the map
      </label>
      </>}

      {measuring && mode !== 'walk' && (
        <div className="progress" role="status">
          <div style={{ width: `${Math.min(100, (elapsed / samples) * 100)}%` }} />
          <span className="small">Hold still… {Math.min(elapsed, samples)} / {samples} s</span>
        </div>
      )}

      <form className="row" onSubmit={submitManual}>
        <label htmlFor="manual">Manual dBm</label>
        <input id="manual" type="number" min="-110" max="-10" step="0.1" placeholder="-65"
          required value={manualRssi} onChange={(e) => setManualRssi(e.target.value)} />
        <button type="submit" disabled={!selected || measuring}>Add</button>
      </form>
    </section>
  )
}
