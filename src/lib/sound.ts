// @ts-nocheck
// Small, self-contained sound cues synthesized with the Web Audio API.
// No audio files, no network requests — just oscillators.

let ctx = null
let muted = typeof localStorage !== 'undefined' && localStorage.getItem('qrft_muted') === '1'

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

export function isMuted() {
  return muted
}

export function setMuted(value) {
  muted = value
  try {
    localStorage.setItem('qrft_muted', value ? '1' : '0')
  } catch {}
}

export function toggleMuted() {
  setMuted(!muted)
  return muted
}

function beep({ freq = 880, duration = 0.05, type = 'sine', gain = 0.04, delay = 0 }) {
  if (muted) return
  try {
    const c = getCtx()
    const start = c.currentTime + delay
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.value = gain
    osc.connect(g)
    g.connect(c.destination)
    g.gain.setValueAtTime(gain, start)
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    osc.start(start)
    osc.stop(start + duration + 0.02)
  } catch {
    // Audio can fail silently (autoplay policy before first user gesture) — non-critical.
  }
}

/** Soft tick each time the sender advances to a new QR frame. */
export function frameTick() {
  beep({ freq: 720, duration: 0.02, type: 'square', gain: 0.02 })
}

/** Soft blip each time the receiver captures a new (non-duplicate) chunk. */
export function chunkBlip() {
  beep({ freq: 1400, duration: 0.035, type: 'sine', gain: 0.035 })
}

/** Rising three-note chime on successful, verified completion. */
export function successChime() {
  beep({ freq: 660, duration: 0.12, gain: 0.05 })
  beep({ freq: 880, duration: 0.12, gain: 0.05, delay: 0.09 })
  beep({ freq: 1320, duration: 0.2, gain: 0.06, delay: 0.18 })
}

/** Low buzz on checksum failure. */
export function errorBuzz() {
  beep({ freq: 140, duration: 0.25, type: 'sawtooth', gain: 0.05 })
}
