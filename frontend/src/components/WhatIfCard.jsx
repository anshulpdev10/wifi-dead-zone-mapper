// WhatIfCard.jsx - "what if the router stood somewhere else?"
// Drag on the map to move a proposed router; the backend predicts the new
// heatmap from the calibrated path-loss model plus each reading's residual
// (GET /api/surveys/<id>/whatif?x=&y=). This card compares it with today.
import { describePosition } from '../guide.js'

export default function WhatIfCard({ calibration, whatIfMode, whatIf, current, onToggle, onApply }) {
  const ready = calibration?.ready
  const p = whatIf?.result?.stats
  const now = current?.stats
  const diff = (a, b, unit, betterHigher) => {
    if (a == null || b == null) return null
    const d = Math.round((a - b) * 10) / 10
    const good = betterHigher ? d > 0 : d < 0
    return <span className={d === 0 ? 'muted' : good ? 'up' : 'down'}>{d > 0 ? '+' : ''}{d}{unit}</span>
  }

  return (
    <section className="card" aria-labelledby="whatif-title">
      <h2 id="whatif-title">What-if: move the router</h2>
      {!ready ? (
        <p className="muted small">Needs the path-loss calibration first (router placed + 5 readings).</p>
      ) : (
        <>
          <label className="check">
            <input type="checkbox" checked={whatIfMode} onChange={(e) => onToggle(e.target.checked)} />
            What-if mode: drag on the map to move the router
          </label>
          {whatIfMode && !whatIf && <p className="muted small">Press and drag anywhere on the map.</p>}
          {whatIf?.error && <p className="error small" role="alert">{whatIf.error}</p>}
          {p && (
            <>
              <p className="small">Proposed router: <strong>{describePosition(whatIf.router)}</strong></p>
              <table className="compare">
                <thead><tr><th></th><th>Now</th><th>Predicted</th><th>Change</th></tr></thead>
                <tbody>
                  <tr><td>Healthy</td><td>{now?.healthy_pct ?? '–'}%</td><td>{p.healthy_pct}%</td><td>{diff(p.healthy_pct, now?.healthy_pct, ' %', true)}</td></tr>
                  <tr><td>Dead</td><td>{now?.dead_pct ?? '–'}%</td><td>{p.dead_pct}%</td><td>{diff(p.dead_pct, now?.dead_pct, ' %', false)}</td></tr>
                  <tr><td>Dead area</td><td>{now?.dead_area_m2 ?? '–'} m²</td><td>{p.dead_area_m2} m²</td><td>{diff(p.dead_area_m2, now?.dead_area_m2, ' m²', false)}</td></tr>
                </tbody>
              </table>
              <p className="muted small">
                Estimate: model (n = {calibration.n}) + each reading's measured deviation, assuming
                walls stay where they are. Verify with a new survey after moving the router.
              </p>
              <button onClick={onApply}>Set router here</button>
            </>
          )}
        </>
      )}
    </section>
  )
}
