// position.js - a floor-map position in words.
// (0, 0) is the map's top-left corner: x = metres from the left wall, y = from the top wall.
export function describePosition(point) {
  return `${point.x.toFixed(1)} m from left wall · ${point.y.toFixed(1)} m from top wall`
}
