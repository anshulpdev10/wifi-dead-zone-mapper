// CalibrationPanel.jsx - the log-distance path-loss model fitted to THIS building
// (GET /api/surveys/<id>/calibration):
//     RSSI(d) = A - 10 * n * log10(d)
// Shows n, A and R^2 and a scatter plot (inline SVG) of measured RSSI against
// distance on a log scale - on a log axis the model is a straight line.
// Orange-ringed points are "obstructed": 8+ dB weaker than the model predicts.
import { bandFor } from '../bands.js'

const W = 300, H = 170
const PAD = { left: 34, right: 8, top: 8, bottom: 26 }
const TICKS_M = [0.5, 1, 2, 5, 10, 20, 50, 100]

export default function CalibrationPanel({ calibration }) {
  if (!calibration) return null
  if (!calibration.ready) {
    return (
      <section className="card" aria-labelledby="cal-title">
        <h2 id="cal-title">Path-loss calibration</h2>
        <p className="muted">{calibration.message}</p>
      </section>
    )
  }

  const { points, curve, n, A, r2 } = calibration
  // Axis ranges: x = log10(distance), y = dBm.
  const ds = points.map((p) => p.distance_m)
  const lx0 = Math.log10(Math.min(...ds) * 0.8), lx1 = Math.log10(Math.max(...ds) * 1.25)
  const all = [...points.map((p) => p.rssi), ...curve.map((c) => c.rssi)]
  const y0 = Math.ceil((Math.max(...all) + 3) / 5) * 5, y1 = Math.floor((Math.min(...all) - 3) / 5) * 5
  const sx = (d) => PAD.left + ((Math.log10(d) - lx0) / (lx1 - lx0)) * (W - PAD.left - PAD.right)
  const sy = (v) => PAD.top + ((y0 - v) / (y0 - y1)) * (H - PAD.top - PAD.bottom)
  const xTicks = TICKS_M.filter((t) => Math.log10(t) >= lx0 && Math.log10(t) <= lx1)
  const yTicks = []
  for (let v = y0; v >= y1; v -= 10) yTicks.push(v)

  return (
    <section className="card" aria-labelledby="cal-title">
      <h2 id="cal-title">Path-loss calibration</h2>
      <dl className="stats three">
        <div><dt>n (exponent)</dt><dd>{n}</dd></div>
        <div><dt>A (at 1 m)</dt><dd>{A} dBm</dd></div>
        <div><dt>R² (fit)</dt><dd>{r2 ?? '–'}</dd></div>
      </dl>
      <p className="small">{calibration.summary}</p>

      <svg className="scatter" viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Measured signal against distance with fitted line, n = ${n}`}>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} className="grid-line" />
            <text x={PAD.left - 4} y={sy(v) + 3} textAnchor="end" className="axis-text">{v}</text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={t}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.top} y2={H - PAD.bottom} className="grid-line" />
            <text x={sx(t)} y={H - PAD.bottom + 12} textAnchor="middle" className="axis-text">{t}</text>
          </g>
        ))}
        <text x={(W + PAD.left) / 2} y={H - 3} textAnchor="middle" className="axis-text">distance from router (m, log scale)</text>
        <polyline fill="none" stroke="#1f6feb" strokeWidth="2"
          points={curve.map((c) => `${sx(c.distance_m)},${sy(c.rssi)}`).join(' ')} />
        {points.map((p, i) => (
          <g key={p.id ?? i}>
            {p.obstructed && <circle cx={sx(p.distance_m)} cy={sy(p.rssi)} r="7" fill="none"
              stroke="#d97706" strokeWidth="1.5" strokeDasharray="2 2" />}
            <circle cx={sx(p.distance_m)} cy={sy(p.rssi)} r="3.5" fill={bandFor(p.rssi).color}
              stroke="#1b1f24" strokeWidth="0.8">
              <title>{`${p.distance_m} m: ${p.rssi} dBm (model ${p.predicted}, residual ${p.residual} dB)`}</title>
            </circle>
          </g>
        ))}
      </svg>
      <p className="muted small">
        Blue line = fitted model. {calibration.obstructed > 0
          ? `${calibration.obstructed} reading(s) are 8+ dB below it (orange ring) - something is in the way.`
          : 'No reading is far below the model.'}
      </p>
    </section>
  )
}
