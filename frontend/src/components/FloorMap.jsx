// FloorMap.jsx - draws the floor on an HTML <canvas> and turns clicks into
// positions in metres.
//
// Drawing order (bottom to top):
//   1. floor-plan image (optional)      5. measured points + dBm labels
//   2. heatmap cells coloured by band   6. router (triangle)
//   3. 1 m grid                         7. suggested extender (star)
//   4. dashed outline of dead cells     8. live-signal ring + crosshair at my position
//
// Keyboard: arrow keys move the crosshair 0.5 m (Shift = 0.1 m),
// Enter places the router there when in "Place router" mode.
import { useEffect, useRef, useState } from 'react'
import { bandFor, DEAD_DBM } from '../bands.js'

const HEATMAP_ALPHA = 0.55   // see-through so the plan image stays visible

export default function FloorMap({ survey, readings, map, showHeatmap, mode, selected, live, onSelect, onPick }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [boxWidth, setBoxWidth] = useState(600)
  const [planImage, setPlanImage] = useState(null)

  // Follow the width of the container so the map resizes with the window.
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width))
    observer.observe(wrapRef.current)
    return () => observer.disconnect()
  }, [])

  // Load the floor-plan image (stored as a data URL) whenever it changes.
  useEffect(() => {
    setPlanImage(null)
    if (!survey.plan) return
    const img = new Image()
    img.onload = () => setPlanImage(img)
    img.src = survey.plan
  }, [survey.plan])

  // Pixels per metre: fit the width, but never taller than 70% of the screen.
  const scale = Math.max(5, Math.min(boxWidth / survey.width, (window.innerHeight * 0.7) / survey.height))
  const cssW = survey.width * scale
  const cssH = survey.height * scale

  // Redraw everything whenever any input changes.
  useEffect(() => {
    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 1          // sharp lines on HiDPI screens
    canvas.width = Math.round(cssW * dpr)
    canvas.height = Math.round(cssH * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const px = (metres) => metres * scale             // metres -> pixels

    // Background + plan image
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, cssW, cssH)
    if (planImage) ctx.drawImage(planImage, 0, 0, cssW, cssH)

    const grid = map?.ready ? map.grid : null

    // 2. Heatmap: one solid rectangle per grid cell, drawn on a hidden canvas
    //    first and then laid over the plan see-through in one go (drawing each
    //    cell see-through would leave darker seams where the cells overlap).
    if (grid && showHeatmap) {
      const layer = document.createElement('canvas')
      layer.width = canvas.width
      layer.height = canvas.height
      const lctx = layer.getContext('2d')
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const size = px(grid.cell)
      grid.values.forEach((row, r) =>
        row.forEach((value, c) => {
          lctx.fillStyle = bandFor(value).color
          lctx.fillRect(c * size, r * size, size + 0.5, size + 0.5)   // +0.5 hides hairline gaps
        })
      )
      ctx.globalAlpha = HEATMAP_ALPHA
      ctx.drawImage(layer, 0, 0, cssW, cssH)
      ctx.globalAlpha = 1
    }

    // 3. 1-metre grid
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = 1; x < survey.width; x++) { ctx.moveTo(px(x), 0); ctx.lineTo(px(x), cssH) }
    for (let y = 1; y < survey.height; y++) { ctx.moveTo(0, px(y)); ctx.lineTo(cssW, px(y)) }
    ctx.stroke()

    // 4. Dead-zone outline: draw a cell edge wherever a dead cell touches a non-dead cell
    //    (skipped for a preliminary map of 1-2 readings - too few to locate a dead zone)
    if (grid && !map.partial) {
      const size = px(grid.cell)
      const isDead = (r, c) => r >= 0 && c >= 0 && r < grid.rows && c < grid.cols && grid.values[r][c] < DEAD_DBM
      ctx.beginPath()
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          if (!isDead(r, c)) continue
          const x0 = c * size, y0 = r * size, x1 = Math.min(x0 + size, cssW), y1 = Math.min(y0 + size, cssH)
          if (!isDead(r - 1, c)) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0) }
          if (!isDead(r + 1, c)) { ctx.moveTo(x0, y1); ctx.lineTo(x1, y1) }
          if (!isDead(r, c - 1)) { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1) }
          if (!isDead(r, c + 1)) { ctx.moveTo(x1, y0); ctx.lineTo(x1, y1) }
        }
      }
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = '#7a1d12'
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.setLineDash([])
    }

    // 5. Measured points with their dBm value
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    readings.forEach((reading) => {
      const x = px(reading.x), y = px(reading.y)
      ctx.beginPath()
      ctx.arc(x, y, 5, 0, Math.PI * 2)
      ctx.fillStyle = bandFor(reading.rssi_mean).color
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#1b1f24'
      ctx.stroke()
      const label = Math.round(reading.rssi_mean).toString()
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'      // white halo keeps text readable
      ctx.strokeText(label, x, y - 9)
      ctx.fillStyle = '#1b1f24'
      ctx.fillText(label, x, y - 9)
    })

    // 6. Router: blue triangle
    if (survey.router) {
      const x = px(survey.router.x), y = px(survey.router.y)
      ctx.beginPath()
      ctx.moveTo(x, y - 11); ctx.lineTo(x + 10, y + 7); ctx.lineTo(x - 10, y + 7); ctx.closePath()
      ctx.fillStyle = '#2563eb'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
    }

    // 7. Suggested extender: purple 5-point star
    if (map?.ready && map.suggestion) {
      const x = px(map.suggestion.x), y = px(map.suggestion.y)
      ctx.beginPath()
      for (let i = 0; i < 10; i++) {
        const radius = i % 2 === 0 ? 12 : 5
        const angle = -Math.PI / 2 + (i * Math.PI) / 5
        ctx.lineTo(x + radius * Math.cos(angle), y + radius * Math.sin(angle))
      }
      ctx.closePath()
      ctx.fillStyle = '#7c3aed'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#ffffff'
      ctx.stroke()
    }

    // 8. My position: a 1 m ring coloured by the LIVE signal, then the crosshair
    if (selected) {
      const x = px(selected.x), y = px(selected.y)
      if (live != null) {
        const color = bandFor(live).color
        ctx.beginPath()
        ctx.arc(x, y, px(1), 0, Math.PI * 2)
        ctx.globalAlpha = 0.35
        ctx.fillStyle = color
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.lineWidth = 2
        ctx.strokeStyle = color
        ctx.stroke()
        ctx.font = '700 12px system-ui, sans-serif'
        ctx.lineWidth = 3
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.strokeText(`live ${Math.round(live)}`, x, y + 22)
        ctx.fillStyle = '#111827'
        ctx.fillText(`live ${Math.round(live)}`, x, y + 22)
      }
      ctx.strokeStyle = '#111827'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(x, 0); ctx.lineTo(x, cssH)
      ctx.moveTo(0, y); ctx.lineTo(cssW, y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.arc(x, y, 9, 0, Math.PI * 2)
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }, [survey, readings, map, showHeatmap, selected, live, planImage, scale, cssW, cssH])

  // Round to 0.1 m and keep inside the floor.
  const toPoint = (x, y) => ({
    x: Math.round(Math.min(Math.max(x, 0), survey.width) * 10) / 10,
    y: Math.round(Math.min(Math.max(y, 0), survey.height) * 10) / 10,
  })

  function handleClick(event) {
    const rect = canvasRef.current.getBoundingClientRect()
    onPick(toPoint((event.clientX - rect.left) / scale, (event.clientY - rect.top) / scale))
  }

  function handleKeyDown(event) {
    const step = event.shiftKey ? 0.1 : 0.5
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    const start = selected || { x: survey.width / 2, y: survey.height / 2 }
    if (moves[event.key]) {
      event.preventDefault()
      onSelect(toPoint(start.x + moves[event.key][0], start.y + moves[event.key][1]))
    } else if (event.key === 'Enter' && selected) {
      onPick(selected)
    }
  }

  return (
    <div ref={wrapRef} className="map-wrap">
      <canvas
        ref={canvasRef}
        className={`floor-canvas mode-${mode}`}
        style={{ width: cssW, height: cssH }}
        tabIndex={0}
        role="img"
        aria-label={`Floor map ${survey.width} by ${survey.height} metres. Click or use arrow keys to choose a position.`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}
