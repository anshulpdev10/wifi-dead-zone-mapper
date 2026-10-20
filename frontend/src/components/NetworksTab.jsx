// NetworksTab.jsx - every network the laptop can hear (GET /api/networks,
// refreshed by the backend every 10 s):
//   - table: SSID, signal, channel, band (my network highlighted)
//   - 2.4 GHz chart: each network is a 22 MHz-wide "hump" centred on its channel
//     (channels are only 5 MHz apart, so humps overlap = interference).
//     Channels 1 / 6 / 11 (the non-overlapping ones) are marked and the least
//     crowded one is recommended.
//   - 5 GHz chart: one bar per channel (5 GHz channels do not overlap like this).
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { bandFor } from '../bands.js'

const POLL_MS = 5000
const MINE = '#1f6feb'
const OTHER = '#8a94a6'
const SIG_TOP = -30, SIG_BOTTOM = -100

const heightOf = (rssi) => Math.max(0, Math.min(1, (rssi - SIG_BOTTOM) / (SIG_TOP - SIG_BOTTOM)))

function Chart24({ networks, recommended }) {
  const W = 640, H = 220, PAD = { left: 36, right: 12, top: 14, bottom: 28 }
  const ch0 = -1, ch1 = 16                                   // x axis in channel numbers
  const sx = (ch) => PAD.left + ((ch - ch0) / (ch1 - ch0)) * (W - PAD.left - PAD.right)
  const base = H - PAD.bottom
  const sy = (rssi) => base - heightOf(rssi) * (base - PAD.top)
  const list = networks.filter((n) => n.channel >= 1 && n.channel <= 14)
  const labelled = new Set([...list].sort((a, b) => b.rssi - a.rssi).slice(0, 6).map((n) => n.bssid))

  // Label positions: move a label up if it would sit on top of one already placed.
  const placed = []
  const labelY = (n) => {
    let y = sy(n.rssi) - 4
    while (placed.some((p) => Math.abs(p.x - sx(n.channel)) < 60 && Math.abs(p.y - y) < 12)) y -= 13
    placed.push({ x: sx(n.channel), y })
    return y
  }

  return (
    <svg className="channel-chart" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`2.4 GHz channel usage, recommended channel ${recommended ?? 'unknown'}`}>
      {[-40, -60, -80, -100].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} className="grid-line" />
          <text x={PAD.left - 4} y={sy(v) + 3} textAnchor="end" className="axis-text">{v}</text>
        </g>
      ))}
      {[1, 6, 11].map((c) => (
        <g key={c}>
          <rect x={sx(c - 0.5)} y={PAD.top} width={sx(c + 0.5) - sx(c - 0.5)} height={base - PAD.top}
            fill={c === recommended ? '#2BB673' : '#d9dee5'} opacity={c === recommended ? 0.25 : 0.35} />
          {c === recommended && <text x={sx(c)} y={PAD.top + 10} textAnchor="middle" className="axis-text rec">best: {c}</text>}
        </g>
      ))}
      {list.map((n) => {
        // 22 MHz wide = about 2.2 channels each side of the centre
        const x0 = sx(n.channel - 2.2), x1 = sx(n.channel + 2.2), xc = sx(n.channel), top = sy(n.rssi)
        // A cubic curve only rises 3/4 of the way to its control points,
        // so put them higher to make the peak land exactly on the signal level.
        const ctrl = base + (top - base) / 0.75
        const color = n.connected ? MINE : OTHER
        return (
          <g key={n.bssid ?? `${n.ssid}-${n.channel}`}>
            <path d={`M${x0},${base} C${x0 + (xc - x0) * 0.35},${ctrl} ${x1 - (x1 - xc) * 0.35},${ctrl} ${x1},${base}`}
              fill={color} fillOpacity={n.connected ? 0.3 : 0.12} stroke={color} strokeWidth={n.connected ? 2.5 : 1} />
            {(labelled.has(n.bssid) || n.connected) && (
              <text x={xc} y={labelY(n)} textAnchor="middle" className={`axis-text ${n.connected ? 'mine' : ''}`}>{n.ssid}</text>
            )}
          </g>
        )
      })}
      {Array.from({ length: 14 }, (_, i) => i + 1).map((c) => (
        <text key={c} x={sx(c)} y={base + 14} textAnchor="middle" className="axis-text">{c}</text>
      ))}
      <line x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} stroke="#5f6b7a" />
    </svg>
  )
}

function Chart5({ networks }) {
  const list = networks.filter((n) => n.channel > 14)
  const channels = [...new Set(list.map((n) => n.channel))].sort((a, b) => a - b)
  if (!channels.length) return <p className="muted">No 5 GHz networks in range.</p>
  const W = 640, H = 200, PAD = { left: 36, right: 12, top: 14, bottom: 28 }
  const base = H - PAD.bottom
  const slot = (W - PAD.left - PAD.right) / channels.length
  const sy = (rssi) => base - heightOf(rssi) * (base - PAD.top)

  return (
    <svg className="channel-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="5 GHz channel usage">
      {[-40, -60, -80, -100].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={W - PAD.right} y1={sy(v)} y2={sy(v)} className="grid-line" />
          <text x={PAD.left - 4} y={sy(v) + 3} textAnchor="end" className="axis-text">{v}</text>
        </g>
      ))}
      {channels.map((c, i) => {
        const nets = list.filter((n) => n.channel === c).sort((a, b) => b.rssi - a.rssi)
        const barW = Math.min(18, (slot - 6) / nets.length)
        const start = PAD.left + i * slot + (slot - barW * nets.length) / 2
        return (
          <g key={c}>
            {nets.map((n, j) => (
              <rect key={n.bssid ?? j} x={start + j * barW} y={sy(n.rssi)} width={barW - 2} height={base - sy(n.rssi)}
                fill={n.connected ? MINE : OTHER} opacity={n.connected ? 0.9 : 0.55} rx="2">
                <title>{`${n.ssid}: ${n.rssi} dBm, channel ${c}`}</title>
              </rect>
            ))}
            <text x={PAD.left + (i + 0.5) * slot} y={base + 14} textAnchor="middle" className="axis-text">{c}</text>
          </g>
        )
      })}
      <line x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} stroke="#5f6b7a" />
    </svg>
  )
}

export default function NetworksTab({ live }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const load = () => api.get('/networks')
      .then((d) => { if (active) { setData(d); setError(d.error || '') } })
      .catch((err) => active && setError(err.message))
    load()
    const timer = setInterval(load, POLL_MS)
    return () => { active = false; clearInterval(timer) }
  }, [])

  if (!data) return <section className="card"><p className="muted">{error || 'Scanning for networks…'}</p></section>
  // The scan's own "connected" flag, or match the live sample's BSSID.
  const networks = data.networks.map((n) => ({ ...n, connected: n.connected || (!!live?.bssid && n.bssid === live.bssid) }))
  const updated = data.time ? new Date(data.time * 1000).toLocaleTimeString() : '–'

  return (
    <div className="networks">
      {error && <div className="banner error" role="alert"><span>{error}</span></div>}

      <section className="card" aria-labelledby="net-title">
        <h2 id="net-title">Nearby networks ({networks.length}) <span className="muted small">· scanned {updated}</span></h2>
        {networks.length === 0 ? <p className="muted">No networks found yet.</p> : (
          <div className="table-scroll tall">
            <table>
              <thead><tr><th>SSID</th><th>Signal</th><th>Channel</th><th>Band</th></tr></thead>
              <tbody>
                {networks.map((n, i) => (
                  <tr key={n.bssid ?? i} className={n.connected ? 'mine' : ''}>
                    <td>{n.ssid}{n.connected && <span className="tag mine-tag">connected</span>}</td>
                    <td><span className="dot" style={{ background: bandFor(n.rssi).color }} />{n.rssi} dBm</td>
                    <td>{n.channel ?? '–'}</td>
                    <td>{n.band ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">Scan signal comes from Windows' Signal % (dBm ≈ % / 2 − 100), so it is rougher than the live meter.</p>
      </section>

      <section className="card" aria-labelledby="ch24-title">
        <h2 id="ch24-title">2.4 GHz channels</h2>
        <Chart24 networks={networks} recommended={data.recommended_channel} />
        <p className="small">
          {data.recommended_channel
            ? <>Recommended 2.4 GHz channel: <strong>{data.recommended_channel}</strong> - least overlap from other
              networks among the non-overlapping channels 1 / 6 / 11
              {data.channel_load && <> (load: {Object.entries(data.channel_load).map(([c, v]) => `ch ${c} ${v ?? '–'} dBm`).join(', ')})</>}.</>
            : 'Not enough 2.4 GHz networks to recommend a channel.'}
        </p>
      </section>

      <section className="card" aria-labelledby="ch5-title">
        <h2 id="ch5-title">5 GHz channels</h2>
        <Chart5 networks={networks} />
        <p className="muted small">Blue = your network. 5 GHz has many more channels, so congestion is rarely a problem.</p>
      </section>
    </div>
  )
}
