// bands.js - signal-strength bands and their colours (same as the slides).
// A reading belongs to the first band whose lower limit it reaches.

export const BANDS = [
  { name: 'Excellent', min: -50, color: '#2BB673' },
  { name: 'Good', min: -67, color: '#8CCB5E' },
  { name: 'Fair', min: -75, color: '#F2A93B' },
  { name: 'Weak', min: -85, color: '#EE7B3D' },
  { name: 'Dead zone', min: -Infinity, color: '#E2513C' },
]

// Thresholds (match mapping.py): >= GOOD is healthy, below DEAD is a dead zone.
export const GOOD_DBM = -67
export const DEAD_DBM = -75

export function bandFor(rssi) {
  return BANDS.find((band) => rssi >= band.min)
}

// Text shown for a band's range in the legend, e.g. "≥ −67 dBm".
export function bandRange(band, index) {
  if (band.min === -Infinity) return `< ${BANDS[index - 1].min} dBm`
  return `≥ ${band.min} dBm`
}
