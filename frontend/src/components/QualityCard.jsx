// QualityCard.jsx - connection quality from the backend's pings to the router
// (default gateway), over the last 30 pings:
//   latency = round-trip time of the latest ping
//   jitter  = average change between consecutive pings (smooth = good for calls)
//   loss    = % of pings that got no reply
const RATING = {
  latency_ms: [20, 60],   // <= 20 good, <= 60 ok, more = poor
  jitter_ms: [5, 20],
  loss_pct: [0, 2],
}

function rate(key, value) {
  if (value == null) return ''
  const [good, ok] = RATING[key]
  return value <= good ? 'good' : value <= ok ? 'ok' : 'poor'
}

export default function QualityCard({ latest }) {
  const items = [
    ['Latency', 'latency_ms', 'ms'],
    ['Jitter', 'jitter_ms', 'ms'],
    ['Packet loss', 'loss_pct', '%'],
  ]
  return (
    <section className="card" aria-labelledby="quality-title">
      <h2 id="quality-title">Connection quality</h2>
      <dl className="stats three">
        {items.map(([label, key, unit]) => (
          <div key={key} className={rate(key, latest?.[key])}>
            <dt>{label}</dt>
            <dd>{latest?.[key] != null ? `${latest[key]} ${unit}` : '–'}</dd>
          </div>
        ))}
      </dl>
      <p className="muted small">Pings to the router every second (last 30).</p>
    </section>
  )
}
