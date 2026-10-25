// sound.js - the laptop's voice and beeps, so the survey can run hands-free.
//   say(text) : text-to-speech with the browser's built-in speechSynthesis.
//               Messages are QUEUED, so a result ("Point 3: -72 dBm") is not cut
//               off by the next instruction. stopSpeaking() clears the queue.
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

// Speak text after anything already queued. Returns a promise that resolves
// when this message has been spoken (or straight away if speech is unavailable).
// A timeout fallback resolves it even if the browser never fires "end".
export function say(text) {
  if (!('speechSynthesis' in window)) return Promise.resolve()
  const spoken = text.replace(/m²/g, ' square metres').replace(/−/g, 'minus ').replace(/-(\d)/g, 'minus $1')
  const utterance = new SpeechSynthesisUtterance(spoken)
  utterance.rate = 1.05
  return new Promise((resolve) => {
    const words = spoken.split(/\s+/).length
    const fallback = setTimeout(resolve, 2000 + words * 600)
    const done = () => { clearTimeout(fallback); resolve() }
    utterance.onend = done
    utterance.onerror = done
    window.speechSynthesis.speak(utterance)
  })
}

export function stopSpeaking() {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}
