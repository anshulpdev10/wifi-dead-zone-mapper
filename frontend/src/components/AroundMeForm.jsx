// AroundMeForm.jsx - "Survey around me": name the place, pick a range, go.
// Creates a square map (range x range metres) with YOU in the centre, and the
// app measures right there straight away. Then you walk around and tap where
// you are on the map; the heatmap fills in around you.
//
// Why not GPS? The laptop can only measure Wi-Fi where it IS, and its own
// location is only accurate to hundreds of metres (phone GPS: 5-20 m indoors),
// so your position on the map comes from a tap - "roughly here" is enough.
import { useState } from 'react'
import { RANGES } from '../places.js'
import PlacePicker from './PlacePicker.jsx'

export default function AroundMeForm({ onStart, onCancel, canCancel }) {
  const [place, setPlace] = useState('')
  const [range, setRange] = useState(10)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    if (!place) { setError('Pick or type where you are first.'); return }
    setBusy(true); setError('')
    try {
      await onStart(place, range)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card new-survey" onSubmit={submit} aria-labelledby="around-title">
      <h2 id="around-title">Survey around me</h2>

      <h3>1 · Where are you?</h3>
      <PlacePicker value={place} onChange={setPlace} disabled={busy} idPrefix="around" />

      <h3>2 · How far around you?</h3>
      <div className="range-options" role="radiogroup" aria-label="Survey range">
        {RANGES.map((r) => (
          <label key={r.m} className={`range-option ${range === r.m ? 'on' : ''}`}>
            <input type="radio" name="range" value={r.m} checked={range === r.m} disabled={busy}
              onChange={() => setRange(r.m)} />
            <strong>{r.m} m</strong> <span className="muted small">{r.hint}</span>
          </label>
        ))}
      </div>

      <h3>3 · Start</h3>
      <p className="small">
        Stand in the middle of the area. The first reading is taken right where you stand (the centre of
        the map). Then walk around, stop, and <strong>tap where you are</strong> on the map – it measures
        there and the heatmap grows around you. Tap roughly; it doesn't need to be exact.
      </p>

      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button className="primary big" type="submit" disabled={busy}>
          {busy ? 'Starting…' : `Start: ${range} m around me${place ? ` in ${place}` : ''}`}
        </button>
        {canCancel && <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  )
}
