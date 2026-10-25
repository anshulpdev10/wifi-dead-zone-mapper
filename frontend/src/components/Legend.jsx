// Legend.jsx - explains the map colours and symbols.
import { BANDS, bandRange } from '../bands.js'

export default function Legend() {
  return (
    <ul className="legend" aria-label="Map legend">
      {BANDS.map((band, i) => (
        <li key={band.name}>
          <span className="swatch" style={{ background: band.color }} />
          {band.name} <span className="muted">{bandRange(band, i)}</span>
        </li>
      ))}
      <li><span className="swatch hatched" /> Not measured yet</li>
      <li><span className="swatch dashed" /> Dead-zone outline (&lt; −75)</li>
      <li><span className="symbol" style={{ color: '#2563eb' }}>▲</span> Router</li>
      <li><span className="symbol" style={{ color: '#7c3aed' }}>★</span> Suggested extender</li>
      <li><span className="swatch ring" /> Obstructed (8+ dB below model)</li>
    </ul>
  )
}
