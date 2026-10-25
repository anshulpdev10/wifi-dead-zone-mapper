// useAutoSurvey.js - hands-free guided survey (a small state machine).
//
//   idle ──(next target)──> announce ──(spoken)──> walk ──(countdown ends / Space)──> measure ──> idle ...
//
// announce: the laptop says where to go ("Point 3. From the door corner: ...").
// walk    : counts down while you walk there (starts AFTER the instruction was
//           spoken, so the walking time is not eaten by the speech).
// measure : beep, the backend averages N fresh samples, the result is spoken.
//           A reading that wobbled a lot (std > 4 dB) gets a spoken warning.
// When no target is left, it stops and onComplete() announces the verdict.
import { useEffect, useRef, useState } from 'react'
import { bandFor } from './bands.js'
import { directions } from './guide.js'
import { beep, say, stopSpeaking, unlockAudio } from './sound.js'

const UNSTABLE_STD_DB = 4

export function useAutoSurvey({ guide, setup, walkSeconds, voice, measurePoint, onSkip, onComplete }) {
  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState('idle')          // 'idle' | 'announce' | 'walk' | 'measure'
  const [countdown, setCountdown] = useState(0)
  const [target, setTarget] = useState(null)
  const [last, setLast] = useState(null)              // {n, reading, unstable}
  const speak = (text) => (voice ? say(text) : Promise.resolve())

  // Keep the latest values for the async steps below.
  const live = useRef({})
  live.current = { running, target, measurePoint, onComplete }
  // Bumped on start / pause / skip, so a pending announcement that finishes
  // later knows it is out of date and does not start a countdown.
  const runToken = useRef(0)

  // idle -> announce -> walk: pick the next target, say where it is, then count down.
  useEffect(() => {
    if (!running || phase !== 'idle' || !guide) return
    if (!guide.next) {
      setRunning(false)
      setTarget(null)
      live.current.onComplete?.()
      return
    }
    const token = runToken.current
    setTarget(guide.next)
    setCountdown(walkSeconds)
    setPhase('announce')
    speak(`Point ${guide.next.n}. ${directions(guide.next, setup)}`).then(() => {
      if (runToken.current === token) setPhase((p) => (p === 'announce' ? 'walk' : p))
    })
  }, [running, phase, guide])

  // walk: count down once per second, then measure.
  useEffect(() => {
    if (!running || phase !== 'walk') return
    if (countdown <= 0) { startMeasure(); return }
    if (countdown <= 3) beep(660, 0.08)                   // short ticks: 3, 2, 1
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [running, phase, countdown])

  const measuring = useRef(false)                      // guards against a double Space press

  async function startMeasure() {
    const point = live.current.target
    if (!point || measuring.current) return
    measuring.current = true
    runToken.current += 1                               // a pending announcement must not restart the walk
    stopSpeaking()
    setPhase('measure')
    beep(880, 0.3)
    const reading = await live.current.measurePoint({ x: point.x, y: point.y })
    measuring.current = false
    if (!reading) {                                     // error: stop and let the user decide
      setRunning(false)
      setPhase('idle')
      speak('Measurement failed. The survey is paused.')
      return
    }
    const unstable = reading.rssi_std > UNSTABLE_STD_DB
    setLast({ n: point.n, reading, unstable })
    speak(`Point ${point.n}: ${Math.round(reading.rssi_mean)} dBm, ${bandFor(reading.rssi_mean).name}.` +
      (unstable ? ' The signal was unstable. You can redo this point.' : ''))
    setPhase('idle')                                    // -> next target (guide has refreshed)
  }

  function start() {
    unlockAudio()                                       // allowed: called from a click
    stopSpeaking()
    runToken.current += 1
    setLast(null)
    setPhase('idle')
    setRunning(true)
  }

  function pause() {
    runToken.current += 1
    setRunning(false)
    if (phase === 'walk' || phase === 'announce') setPhase('idle')   // a running measurement finishes by itself
    stopSpeaking()
  }

  // Space: "I'm here" - measure now instead of waiting for the countdown.
  function measureNow() {
    if (running && (phase === 'walk' || phase === 'announce')) startMeasure()
  }

  function skip() {
    if (!target || phase === 'measure') return
    runToken.current += 1
    stopSpeaking()
    onSkip(target.n)
    setPhase('idle')
  }

  return { running, phase, countdown, target, last, start, pause, measureNow, skip }
}
