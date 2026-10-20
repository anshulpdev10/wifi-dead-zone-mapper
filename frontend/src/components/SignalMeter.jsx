// SignalMeter.jsx - live meter fed by the SSE stream (one sample per second):
// big dBm number, band tag, SSID / channel / band, and a 60-second scrolling
// line graph (inline SVG) with dashed lines at -67 (good) and -75 (dead).
// Below -75 dBm the card turns red ("Entering dead zone") and can beep.
import { useEffect, useRef, useState } from 'react'
import { bandFor, DEAD_DBM } from '../bands.js'

const WINDOW_S = 60
const GOOD_DBM = -67
const Y_TOP = -30, Y_BOTTOM = -100       // graph range in dBm
const W = 300, H = 110                   // SVG drawing units

// Short beep with the Web Audio API (no sound files needed).
function beep(ctx) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.frequency.value = 880
  gain.gain.setValueAtTime(0.15, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.25)
}

export function LiveGraph({ samples }) {
  const now = samples.length ? samples[samples.length - 1].time : 0
  const xOf = (t) => W - ((now - t) / WINDOW_S) * W
  const yOf = (dbm) => ((Y_TOP - Math.max(Y_BOTTOM, Math.min(Y_TOP, dbm))) / (Y_TOP - Y_BOTTOM)) * H

  // Build the line; a sample without RSSI (error) breaks the line.
  let d = ''
  let penDown = false
  for (const s of samples) {
    if (now - s.time > WINDOW_S) continue
    if (s.rssi == null) { penDown = false; continue }
    d += `${penDown ? 'L' : 'M'}${xOf(s.time).toFixed(1)},${yOf(s.rssi).toFixed(1)} `
    penDown = true
  }

  return (
    <svg className="live-graph" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
      role="img" aria-label="Signal strength over the last 60 seconds">
      <rect x="0" y="0" width={W} height={yOf(GOOD_DBM)} fill="#2BB673" opacity="0.07" />
      <rect x="0" y={yOf(DEAD_DBM)} width={W} height={H - yOf(DEAD_DBM)} fill="#E2513C" opacity="0.08" />
      {[GOOD_DBM, DEAD_DBM].map((v) => (
        <line key={v} x1="0" x2={W} y1={yOf(v)} y2={yOf(v)} stroke={v === GOOD_DBM ? '#5a9a3c' : '#c0392b'}
          strokeDasharray="4 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      ))}
      <path d={d} fill="none" stroke="#1f6feb" strokeWidth="2" vectorEffect="non-scaling-stroke"
        strokeLinejoin="round" />
    </svg>
  )
}

export default function SignalMeter({ samples, latest, status }) {
  const [beepOn, setBeepOn] = useState(false)
  const audio = useRef(null)
  const wasAlert = useRef(false)

  const rssi = latest?.rssi ?? null
  const band = rssi != null ? bandFor(rssi) : null
  const alert = rssi != null && rssi < DEAD_DBM

  // Beep once each time we ENTER a dead zone (not every second while inside).
  useEffect(() => {
    if (alert && !wasAlert.current && beepOn && audio.current) beep(audio.current)
    wasAlert.current = alert
  }, [alert, beepOn])

  function toggleBeep(on) {
    // Browsers only allow audio after a user action, so create it on this click.
    if (on && !audio.current) audio.current = new (window.AudioContext || window.webkitAudioContext)()
    setBeepOn(on)
  }

  return (
    <section className={`card meter-card ${alert ? 'alert' : ''}`} aria-labelledby="meter-title">
      <h2 id="meter-title">Live signal</h2>
      <div className="meter" aria-live="polite">
        <span className="meter-value">{rssi != null ? Math.round(rssi) : '--'}</span>
        <span className="meter-unit">dBm</span>
        {band && <span className="tag" style={{ background: band.color }}>{band.name}</span>}
      </div>
      {alert && <p className="alert-text" role="alert">⚠ Entering dead zone</p>}
      <p className="muted small">
        {latest?.ssid
          ? <><strong>{latest.ssid}</strong> · ch {latest.channel ?? '?'} · {latest.band ?? '?'}</>
          : status === 'disconnected' ? 'Backend not connected' : 'No network'}
      </p>

      <LiveGraph samples={samples} />
      <div className="graph-axis small muted"><span>−60 s</span><span>dashed: −67 good · −75 dead</span><span>now</span></div>

      {latest?.error && <p className="error small" role="alert">{latest.error}</p>}
      <label className="check small">
        <input type="checkbox" checked={beepOn} onChange={(e) => toggleBeep(e.target.checked)} />
        Beep when entering a dead zone
      </label>
    </section>
  )
}
