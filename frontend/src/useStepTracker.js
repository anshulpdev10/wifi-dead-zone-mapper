// useStepTracker.js - automatic position from the PHONE's sensors (no GPS, no clicking).
// Pedestrian dead reckoning: the accelerometer bounces once per step, and the
// compass says which way you face, so each step moves "you" ~0.7 m that way.
// Laptops have no such sensors, and phones only allow them on an https page
// (npm run dev:lan). Drift: a few % of the distance walked, so tap the map
// now and then to correct your position.
import { useEffect, useRef, useState } from 'react'

const HIGH = 11.2        // m/s²: smoothed |acceleration| above this = foot strike…
const LOW = 9.9          // …and it must drop below this before the next step counts
const MIN_STEP_MS = 280  // nobody walks faster than ~3.5 steps a second

export function sensorsPossible() {
  return typeof window !== 'undefined' && window.isSecureContext && 'DeviceMotionEvent' in window
}

// A phone or tablet (touch screen) - laptops report the API but have no sensors.
export const isPhone = () => sensorsPossible() && window.matchMedia('(pointer: coarse)').matches

// onStep(headingDeg): heading is clockwise from north (or from an arbitrary but
// fixed zero, which is fine: App only uses the change since Start).
export function useStepTracker(active, onStep) {
  const [status, setStatus] = useState('off')   // off | waiting | ok | no-sensors | denied
  const [steps, setSteps] = useState(0)
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep

  useEffect(() => {
    if (!active) { setStatus('off'); return }
    let heading = null
    let smooth = 9.81
    let armed = true
    let lastStep = 0
    let gotMotion = false
    setSteps(0)
    setStatus('waiting')

    function onOrientation(e) {
      if (e.webkitCompassHeading != null) heading = e.webkitCompassHeading      // iOS: clockwise from north
      else if (e.alpha != null) heading = (360 - e.alpha) % 360                 // others: alpha is counter-clockwise
    }
    function onMotion(e) {
      const a = e.accelerationIncludingGravity
      if (!a || a.x == null) return
      if (!gotMotion) { gotMotion = true; setStatus('ok') }
      smooth = 0.75 * smooth + 0.25 * Math.hypot(a.x, a.y, a.z)
      const now = e.timeStamp || performance.now()
      if (armed && smooth > HIGH && now - lastStep > MIN_STEP_MS && heading != null) {
        armed = false
        lastStep = now
        setSteps((s) => s + 1)
        onStepRef.current(heading)
      } else if (smooth < LOW) {
        armed = true
      }
    }

    const orientationEvent = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(orientationEvent, onOrientation)
    window.addEventListener('devicemotion', onMotion)
    // Desktop browsers have the API but never fire it: say so after 3 s.
    const check = setTimeout(() => { if (!gotMotion) setStatus('no-sensors') }, 3000)
    return () => {
      clearTimeout(check)
      window.removeEventListener(orientationEvent, onOrientation)
      window.removeEventListener('devicemotion', onMotion)
    }
  }, [active])

  return { status, steps }
}

// iOS asks for permission, and only from a button press: call this in the click handler.
export async function requestSensorPermission() {
  try {
    for (const api of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
      if (api && typeof api.requestPermission === 'function' && (await api.requestPermission()) !== 'granted') return false
    }
    return true
  } catch {
    return false
  }
}
