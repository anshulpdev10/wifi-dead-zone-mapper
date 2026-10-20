// guide.js - the guided 10-point survey.
//
// The floor is covered by an even 5 x 2 grid of target points (2 x 5 for a
// floor that is taller than wide). Points are numbered in a "snake" order -
// left to right along the first row, right to left along the second - so you
// never have to walk back across the whole floor.
//
// A target counts as done when a saved reading lies within DONE_RADIUS of it,
// so progress survives page reloads without storing anything extra.

export const GUIDE_POINTS = 10
const DONE_RADIUS = 1.0   // metres

export function guidePoints(width, height) {
  const wide = width >= height
  const cols = wide ? 5 : 2
  const rows = wide ? 2 : 5
  const points = []
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const c = r % 2 === 0 ? i : cols - 1 - i          // snake order
      points.push({
        x: Math.round(((c + 0.5) / cols) * width * 10) / 10,
        y: Math.round(((r + 0.5) / rows) * height * 10) / 10,
      })
    }
  }
  return points.map((p, i) => ({ ...p, n: i + 1 }))
}

// Mark each target as done / skipped, and find the next one to visit.
export function guideStatus(width, height, readings, skipped) {
  const points = guidePoints(width, height).map((p) => ({
    ...p,
    done: readings.some((r) => Math.hypot(r.x - p.x, r.y - p.y) <= DONE_RADIUS),
    skipped: skipped.includes(p.n),
  }))
  const next = points.find((p) => !p.done && !p.skipped) || null
  const doneCount = points.filter((p) => p.done).length
  return { points, next, doneCount, complete: !next }
}

// "3.6 m from left wall · 2.0 m from top wall" - (0, 0) is the top-left corner.
export function describePosition(point) {
  return `${point.x.toFixed(1)} m from left wall · ${point.y.toFixed(1)} m from top wall`
}
