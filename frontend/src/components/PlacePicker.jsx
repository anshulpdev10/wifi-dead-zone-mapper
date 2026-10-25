// PlacePicker.jsx - "Where are you?": a group switch (College / Home / Office),
// quick-pick chips for that group, plus a box for any other name ("Lab 3").
// `extra` = names already used in this survey (shown with a ✓).
import { useState } from 'react'
import { PLACE_GROUPS } from '../places.js'

export default function PlacePicker({ value, onChange, extra = [], disabled, idPrefix = 'place' }) {
  const [group, setGroup] = useState('College')
  const [custom, setCustom] = useState('')
  const used = new Set(extra.map((n) => n.toLowerCase()))
  const names = [...PLACE_GROUPS[group], ...extra.filter((n) => !PLACE_GROUPS[group].some((p) => p.toLowerCase() === n.toLowerCase()))]

  return (
    <div className="place-picker">
      <div className="segmented small-seg" role="group" aria-label="Kind of place">
        {Object.keys(PLACE_GROUPS).map((g) => (
          <button key={g} type="button" aria-pressed={group === g} disabled={disabled} onClick={() => setGroup(g)}>{g}</button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Where are you?">
        {names.map((name) => (
          <button key={name} type="button" aria-pressed={!custom && value === name} disabled={disabled}
            onClick={() => { setCustom(''); onChange(name) }}>
            {name}{used.has(name.toLowerCase()) && <span className="chip-done" aria-label="measured"> ✓</span>}
          </button>
        ))}
      </div>
      <div className="row tight">
        <label htmlFor={`${idPrefix}-custom`} className="small">Other name</label>
        <input id={`${idPrefix}-custom`} maxLength={40} value={custom} placeholder="e.g. Lab 3, Room 204" disabled={disabled}
          onChange={(e) => { setCustom(e.target.value); onChange(e.target.value.trim()) }} />
      </div>
    </div>
  )
}
