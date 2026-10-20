// useLiveStream.js - React hook for the live Server-Sent Events stream (/api/stream).
//
// The browser's EventSource keeps one HTTP response open and the backend pushes
//   "sample"  every second  (rssi, ssid, channel, band, latency, jitter, loss, alert)
//   "reading" when a reading is saved or deleted (any open dashboard refreshes)
//   "survey"  when a survey is changed or deleted
//
// status: 'connecting' | 'live' | 'disconnected'. If the backend is down the
// proxy answers with an error and EventSource gives up, so we reconnect ourselves.
import { useEffect, useRef, useState } from 'react'
import { api } from './api.js'

const KEEP = 120            // samples kept (2 minutes)
const RECONNECT_MS = 3000

export function useLiveStream(onEvent) {
  const [status, setStatus] = useState('connecting')
  const [samples, setSamples] = useState([])
  const handler = useRef(onEvent)
  handler.current = onEvent          // always call the latest callback

  useEffect(() => {
    let source = null
    let retryTimer = null
    let closed = false

    // Add samples, skipping any we already have (same timestamp).
    const addSamples = (incoming) =>
      setSamples((prev) => {
        const last = prev.length ? prev[prev.length - 1].time : 0
        return [...prev, ...incoming.filter((s) => s.time > last)].slice(-KEEP)
      })

    function connect() {
      if (closed) return
      // Fill the graph with the backend's ring buffer first.
      api.get('/history').then((data) => addSamples(data.samples)).catch(() => {})

      source = new EventSource('/api/stream')
      source.onopen = () => setStatus('live')
      source.onerror = () => {
        setStatus('disconnected')
        if (source.readyState === EventSource.CLOSED) {      // browser gave up -> retry
          source.close()
          retryTimer = setTimeout(connect, RECONNECT_MS)
        }
      }
      source.addEventListener('sample', (e) => {
        setStatus('live')
        addSamples([JSON.parse(e.data)])
      })
      for (const name of ['reading', 'survey']) {
        source.addEventListener(name, (e) => handler.current?.(name, JSON.parse(e.data)))
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retryTimer)
      source?.close()
    }
  }, [])

  return { status, samples, latest: samples.length ? samples[samples.length - 1] : null }
}
