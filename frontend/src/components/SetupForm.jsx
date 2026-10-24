// SetupForm.jsx - "Room directions": tells the app how the map lines up with the
// real room, because the laptop cannot sense walls or its own position.
//   corner : the real corner at the map's top-left (0, 0)     e.g. "door corner"
//   wall   : the real wall along the map's top edge            e.g. "window wall"
//   step_m : your step length, so directions can be given in steps
// Step length = distance / steps  (e.g. 6 m wall in 8 steps -> 0.75 m per step).
import { useState } from 'react'

function Diagram({ corner, wall }) {
  return (
    <svg className="setup-diagram" viewBox="0 0 260 120" role="img"
      aria-label={`The map's top-left corner is the ${corner || 'corner you choose'}, its top edge is the ${wall || 'wall you choose'}`}>
      <rect x="20" y="22" width="220" height="86" fill="#f4f6f8" stroke="#9aa4b2" />
      <line x1="20" y1="22" x2="240" y2="22" stroke="#1f6feb" strokeWidth="5" />
      <text x="130" y="15" textAnchor="middle" className="diagram-text strong">{wall || 'your wall'}</text>
      <circle cx="20" cy="22" r="7" fill="#ea580c" />
      <text x="30" y="40" className="diagram-text">◤ {corner || 'your corner'} (start)</text>
      <line x1="40" y1="62" x2="150" y2="62" stroke="#1b1f24" markerEnd="url(#arrow)" />
      <text x="95" y="57" textAnchor="middle" className="diagram-text">along the wall</text>
      <line x1="40" y1="62" x2="40" y2="102" stroke="#1b1f24" markerEnd="url(#arrow)" />
      <text x="46" y="98" className="diagram-text">into the room</text>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#1b1f24" />
        </marker>
      </defs>
    </svg>
  )
}

export default function SetupForm({ initial, onSave, onCancel, saveLabel = 'Save directions' }) {
  const [corner, setCorner] = useState(initial?.corner || '')
  const [wall, setWall] = useState(initial?.wall || '')
  const [stepM, setStepM] = useState(initial?.step_m ? String(initial.step_m) : '')
  const [calSteps, setCalSteps] = useState('')
  const [calMetres, setCalMetres] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function calculateStep() {
    const s = Number(calSteps), m = Number(calMetres)
    if (s > 0 && m > 0) setStepM((m / s).toFixed(2))
  }

  async function save(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      await onSave({ corner: corner.trim(), wall: wall.trim(), step_m: stepM ? Number(stepM) : null })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="setup-form" onSubmit={save} aria-label="Room directions">
      <p className="small">
        Stand in one corner of the room. That corner is the map's top-left (0, 0); the wall
        running along on one side of it is the map's top edge.
      </p>
      <Diagram corner={corner} wall={wall} />
      <div className="two-col">
        <div>
          <label htmlFor="su-corner">Start corner</label>
          <input id="su-corner" required maxLength={40} value={corner} placeholder="door corner"
            onChange={(e) => setCorner(e.target.value)} />
        </div>
        <div>
          <label htmlFor="su-wall">Wall along the top</label>
          <input id="su-wall" required maxLength={40} value={wall} placeholder="window wall"
            onChange={(e) => setWall(e.target.value)} />
        </div>
      </div>
      <label htmlFor="su-step">Step length (m, optional - directions in steps too)</label>
      <div className="row tight">
        <input id="su-step" type="number" min="0.3" max="1.2" step="0.01" value={stepM} placeholder="0.75"
          onChange={(e) => setStepM(e.target.value)} />
        <span className="muted small">or: I walked</span>
        <input aria-label="Number of steps" type="number" min="1" value={calSteps} placeholder="8"
          onChange={(e) => setCalSteps(e.target.value)} />
        <span className="muted small">steps over</span>
        <input aria-label="Distance in metres" type="number" min="0.5" step="0.1" value={calMetres} placeholder="6"
          onChange={(e) => setCalMetres(e.target.value)} />
        <span className="muted small">m</span>
        <button type="button" onClick={calculateStep}>Calculate</button>
      </div>
      {error && <p className="error small" role="alert">{error}</p>}
      <div className="row">
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : saveLabel}</button>
        {onCancel && <button type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}
