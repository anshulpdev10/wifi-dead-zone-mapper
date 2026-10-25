// RouterCard.jsx - "Where is my router?"
// The backend works it out from the readings (map.router_estimate): signal falls
// off with distance in a known way (RSSI = A - 10 n log10 d), so it tries every
// spot on the floor and keeps the one whose curve fits the readings best.
// Walls bend the signal, so it is an ESTIMATE with an accuracy circle; the user
// can accept it ("Yes, it's here") or place the router themselves.
import { describePosition } from '../position.js'

export default function RouterCard({ estimate, router, busy, onUse, onPlace, onRemove }) {
  const gap = estimate && router ? Math.hypot(estimate.x - router.x, estimate.y - router.y) : null
  return (
    <section className="card router-card" aria-labelledby="router-title">
      <h2 id="router-title">Where is my router?</h2>
      {router ? (
        <>
          <p className="small">Router: <strong>{describePosition(router)}</strong> (▲ on the map).</p>
          {gap != null && (
            <p className="muted small">
              The readings point to {describePosition(estimate)} – {gap < 1.5 ? 'that matches ✓' : `${gap.toFixed(1)} m away (walls bend the signal).`}
            </p>
          )}
          <button className="link" onClick={onRemove} disabled={busy}>Remove router</button>
        </>
      ) : estimate ? (
        <>
          <p>
            Your router is probably <strong>{describePosition(estimate)}</strong>
            {' '}<span className="muted small">(± {estimate.accuracy_m} m, {estimate.confidence === 'good' ? 'good estimate' : 'rough estimate'})</span>
          </p>
          {estimate.outside && (
            <p className="small">It sits at the edge of the area, so the router may be just outside it, in that direction.</p>
          )}
          {estimate.confidence !== 'good' && (
            <p className="muted small">More readings in different places make this sharper.</p>
          )}
          <div className="row">
            <button className="primary" onClick={() => onUse({ x: estimate.x, y: estimate.y })} disabled={busy}>Yes, it's here</button>
            <button onClick={onPlace} disabled={busy}>I'll place it myself</button>
          </div>
        </>
      ) : (
        <p className="muted small">
          Walk around and take readings in a few different places (at least 4). The app then works out where
          the router is from how the signal gets weaker with distance, and marks it “router?” on the map.
        </p>
      )}
    </section>
  )
}
