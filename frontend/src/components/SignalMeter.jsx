// SignalMeter.jsx - live signal meter. Asks the backend for the laptop's
// current RSSI every 2 seconds. Polling pauses while a measurement runs, so the
// meter does not compete with /measure for the Wi-Fi adapter.
// Each reading is also passed up via onReading, for the live ring on the map.
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { bandFor } from '../bands.js'

const POLL_MS = 2000

export default function SignalMeter({ paused, onReading }) {
  const [reading, setReading] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (paused) return
    let active = true          // stops state updates after the component unmounts

    async function poll() {
      try {
        const data = await api.get('/rssi')
        if (!active) return
        setReading(data)
        setError(data.error || '')
        onReading?.(data)
      } catch (err) {
        if (active) setError(err.message)
      }
    }

    poll()
    const timer = setInterval(poll, POLL_MS)
    return () => { active = false; clearInterval(timer) }
  }, [paused])

  const rssi = reading?.rssi
  const band = rssi != null ? bandFor(rssi) : null
  // Bar fill: -100 dBm = empty, -30 dBm = full.
  const fill = rssi != null ? Math.min(100, Math.max(0, ((rssi + 100) / 70) * 100)) : 0

  return (
    <section className="card" aria-labelledby="meter-title">
      <h2 id="meter-title">
        Live signal {paused && <span className="muted">(paused while measuring)</span>}
      </h2>
      <div className="meter" aria-live="polite">
        <span className="meter-value">{rssi != null ? Math.round(rssi) : '--'}</span>
        <span className="meter-unit">dBm</span>
        {band && <span className="tag" style={{ background: band.color }}>{band.name}</span>}
      </div>
      <div className="meter-bar" aria-hidden="true">
        <div style={{ width: `${fill}%`, background: band?.color || 'transparent' }} />
      </div>
      <p className="muted small">
        {reading?.ssid ? <>Network: <strong>{reading.ssid}</strong> · {reading.method}</> : 'No network'}
      </p>
      {error && <p className="error small" role="alert">{error}</p>}
    </section>
  )
}
