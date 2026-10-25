// StatsPanel.jsx - results from GET /api/surveys/<id>/map:
// extender verdict, dead zones (located in metres from the walls),
// coverage statistics and advice. Marked "preliminary" while less than
// 90 % of the floor has been measured.
import { describePosition } from '../position.js'

export default function StatsPanel({ map }) {
  if (!map) return null

  // No readings yet, or only a preliminary heatmap (fewer than 3 readings).
  if (!map.ready || !map.stats) {
    return (
      <section className="card" aria-labelledby="stats-title">
        <h2 id="stats-title">Results</h2>
        <p className="muted">{map.message}</p>
      </section>
    )
  }

  const s = map.stats
  const ext = map.extender
  return (
    <section className="card" aria-labelledby="stats-title">
      <h2 id="stats-title">
        Results {s.measured_pct < 90 && <span className="muted">(preliminary – measure the hatched areas)</span>}
      </h2>

      {/* 1. The headline answer: is an extender required?
             (skipped if an older backend without the "extender" field is running) */}
      {ext && <div className={`verdict ${ext.needed ? 'needed' : 'ok'}`}>
        <strong>{ext.needed ? '★ Extender required' : '✓ No extender needed'}</strong>
        <span>{ext.reason}</span>
        {map.suggestion && (
          <span className="small">Extender spot: {describePosition(map.suggestion)} ({map.suggestion.rssi} dBm there)</span>
        )}
      </div>}

      {/* 2. Dead zones, largest first */}
      {map.regions.length > 0 && (
        <>
          <h3>Dead zones (&lt; −75 dBm)</h3>
          <ol className="zones">
            {map.regions.map((reg, i) => (
              <li key={i}>
                <strong>{reg.area_m2} m²</strong> around {describePosition(reg.center)} · worst {reg.worst_dbm} dBm
              </li>
            ))}
          </ol>
        </>
      )}

      {/* 3. Coverage statistics: stacked bar = healthy / marginal / dead share of the floor */}
      <div className="coverage-bar" aria-hidden="true">
        <div style={{ width: `${s.healthy_pct}%`, background: '#8CCB5E' }} />
        <div style={{ width: `${s.marginal_pct}%`, background: '#F2A93B' }} />
        <div style={{ width: `${s.dead_pct}%`, background: '#E2513C' }} />
      </div>

      <dl className="stats">
        {/* percentages are of the measured part of the floor (hatched areas left out) */}
        <div><dt>Healthy (≥ −67)</dt><dd>{s.healthy_pct}%</dd></div>
        <div><dt>Marginal</dt><dd>{s.marginal_pct}%</dd></div>
        <div><dt>Dead (&lt; −75)</dt><dd>{s.dead_pct}%</dd></div>
        <div><dt>Dead area</dt><dd>{s.dead_area_m2} m²</dd></div>
        {s.measured_pct != null && <div><dt>Floor measured</dt><dd>{s.measured_pct}%</dd></div>}
        <div><dt>Average</dt><dd>{s.avg_dbm} dBm</dd></div>
        <div><dt>Best / worst</dt><dd>{s.best_dbm} / {s.worst_dbm}</dd></div>
      </dl>

      <ul className="advice">
        {map.advice.map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
    </section>
  )
}
