// NewSurveyForm.jsx - create a survey: name, floor size in metres and an
// optional floor-plan image. The image is shrunk in the browser (max 1400 px,
// JPEG) before upload so the database row stays small.
import { useState } from 'react'

const MAX_SIDE = 1400

// Read a File, draw it on a canvas at most 1400 px wide/high, return a JPEG data URL.
function downscaleImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(1, MAX_SIDE / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * ratio)
      canvas.height = Math.round(img.height * ratio)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff'                     // transparent PNGs -> white
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a readable image.')) }
    img.src = url
  })
}

export default function NewSurveyForm({ onCreate, onCancel, canCancel }) {
  const [name, setName] = useState('')
  const [width, setWidth] = useState('12')
  const [height, setHeight] = useState('8')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const plan = file ? await downscaleImage(file) : null
      await onCreate({ name, width: Number(width), height: Number(height), plan })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <form className="card new-survey" onSubmit={handleSubmit} aria-labelledby="new-title">
      <h2 id="new-title">New survey</h2>

      <label htmlFor="sv-name">Name</label>
      <input id="sv-name" required maxLength={80} value={name} autoFocus
        placeholder="e.g. Ground floor, Hostel block B" onChange={(e) => setName(e.target.value)} />

      <div className="two-col">
        <div>
          <label htmlFor="sv-width">Width (m)</label>
          <input id="sv-width" type="number" min="1" max="200" step="0.1" required
            value={width} onChange={(e) => setWidth(e.target.value)} />
        </div>
        <div>
          <label htmlFor="sv-height">Height (m)</label>
          <input id="sv-height" type="number" min="1" max="200" step="0.1" required
            value={height} onChange={(e) => setHeight(e.target.value)} />
        </div>
      </div>

      <label htmlFor="sv-plan">Floor-plan image (optional)</label>
      <input id="sv-plan" type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0] || null)} />
      <p className="muted small">Measure the real floor size: the image is stretched to width × height.</p>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="row">
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create survey'}</button>
        {canCancel && <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>}
      </div>
    </form>
  )
}
