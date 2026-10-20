// GuidePanel.jsx - step-by-step instructions for the guided 10-point survey:
// where to walk next (in metres from the walls), a button to measure there,
// and a skip button for spots you cannot reach (inside a wardrobe, etc.).
import { describePosition, GUIDE_POINTS } from '../guide.js'

export default function GuidePanel({ guide, measuring, samples, onMeasurePoint, onSkip, onResetSkips }) {
  const { next, doneCount, points } = guide
  const skippedCount = points.filter((p) => p.skipped && !p.done).length

  return (
    <section className="card guide" aria-labelledby="guide-title">
      <h2 id="guide-title">Guided survey · {doneCount} / {GUIDE_POINTS} points</h2>
      <div className="progress-track" aria-hidden="true">
        <div style={{ width: `${(doneCount / GUIDE_POINTS) * 100}%` }} />
      </div>

      {next ? (
        <>
          <p className="guide-target">
            Walk to point <span className="badge">{next.n}</span>
            <strong>{describePosition(next)}</strong>
          </p>
          <div className="row">
            <button className="primary" disabled={measuring} onClick={() => onMeasurePoint(next)}>
              {measuring ? 'Measuring…' : `I'm here – measure ${samples} s`}
            </button>
            <button disabled={measuring} onClick={() => onSkip(next.n)}>Skip point</button>
          </div>
          <p className="muted small">
            Blue numbered circles on the map are the targets. You can also click any other spot to measure it.
          </p>
        </>
      ) : (
        <p className="guide-done">
          {doneCount === GUIDE_POINTS ? 'All 10 points measured ✓' : `Guided points finished (${skippedCount} skipped) ✓`}
          {' '}— the heatmap, dead zones and extender advice below are your results.
          {' '}Add extra points anywhere the map looks uncertain.
        </p>
      )}
      {skippedCount > 0 && (
        <button className="link" onClick={onResetSkips}>Bring back {skippedCount} skipped point(s)</button>
      )}
    </section>
  )
}
