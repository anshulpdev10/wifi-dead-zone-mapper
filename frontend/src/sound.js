// sound.js - the laptop's voice and beeps, so the survey can run hands-free.
//   say(text) : text-to-speech with the browser's built-in speechSynthesis
//   beep()    : short tone with the Web Audio API (no sound files needed)

let audio = null

// Browsers only allow sound after a user action - call this from a click.
export function unlockAudio() {
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)()
  if (audio.state === 'suspended') audio.resume()
  return audio
}

export function beep(freq = 880, seconds = 0.25) {
  if (!audio) return
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.15, audio.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + seconds)
  osc.connect(gain).connect(audio.destination)
  osc.start()
  osc.stop(audio.currentTime + seconds)
}

export function say(text) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()                     // newest message wins
  const utterance = new SpeechSynthesisUtterance(text.replace(/−/g, 'minus ').replace(/-(\d)/g, 'minus $1'))
  utterance.rate = 1.05
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}
