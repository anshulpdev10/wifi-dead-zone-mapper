// StatsPanel.jsx - coverage statistics and advice from GET /api/surveys/<id>/map.
export default function StatsPanel({ map }) {
  if (!map) return null

  // No readings yet, or only a preliminary heatmap (fewer than 3 readings).
  if (!map.ready || !map.stats) {
    return (
      <section className="card" aria-labelledby="stats-title">
        <h2 id="stats-title">Coverage</h2>
        <p className="muted">{map.message}</p>
      </section>
    )
  }

  const s = map.stats
  return (
    <section className="card" aria-labelledby="stats-title">
      <h2 id="stats-title">Coverage</h2>

      {/* Stacked bar: healthy / marginal / dead share of the floor */}
      <div className="coverage-bar" aria-hidden="true">
        <div style={{ width: `${s.healthy_pct}%`, background: '#8CCB5E' }} />
        <div style={{ width: `${s.marginal_pct}%`, background: '#F2A93B' }} />
        <div style={{ width: `${s.dead_pct}%`, background: '#E2513C' }} />
      </div>

      <dl className="stats">
        <div><dt>Healthy (≥ −67)</dt><dd>{s.healthy_pct}%</dd></div>
        <div><dt>Marginal</dt><dd>{s.marginal_pct}%</dd></div>
        <div><dt>Dead (&lt; −75)</dt><dd>{s.dead_pct}%</dd></div>
        <div><dt>Dead area</dt><dd>{s.dead_area_m2} m²</dd></div>
        <div><dt>Average</dt><dd>{s.avg_dbm} dBm</dd></div>
        <div><dt>Best / worst</dt><dd>{s.best_dbm} / {s.worst_dbm}</dd></div>
      </dl>

      {map.regions.length > 0 && (
        <p className="small muted">{map.regions.length} dead region(s) found.</p>
      )}
      <ul className="advice">
        {map.advice.map((tip) => <li key={tip}>{tip}</li>)}
      </ul>
    </section>
  )
}
