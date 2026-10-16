/** Short synthesized sound effects (no audio files to download). */

let ctx: AudioContext | null = null
let enabled = true

export function setSoundEnabled(on: boolean) {
  enabled = on
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx ??= new Ctor()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(freq: number, start: number, duration: number, type: OscillatorType = 'sine', gain = 0.08) {
  const ac = audio()
  if (!ac) return
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  const t0 = ac.currentTime + start
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(g).connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.02)
}

export type SoundName = 'correct' | 'incorrect' | 'match' | 'complete' | 'blast' | 'clear' | 'place'

export function playSound(name: SoundName) {
  if (!enabled) return
  try {
    switch (name) {
      case 'correct':
        tone(660, 0, 0.12)
        tone(880, 0.09, 0.16)
        break
      case 'incorrect':
        tone(220, 0, 0.22, 'triangle', 0.1)
        break
      case 'match':
        tone(740, 0, 0.1)
        break
      case 'complete':
        tone(523, 0, 0.14)
        tone(659, 0.12, 0.14)
        tone(784, 0.24, 0.24)
        break
      case 'blast':
        tone(180, 0, 0.18, 'sawtooth', 0.05)
        break
      case 'clear':
        tone(880, 0, 0.1)
        tone(1175, 0.08, 0.18)
        break
      case 'place':
        tone(440, 0, 0.06, 'square', 0.03)
        break
    }
  } catch {
    // Audio is a nice-to-have; ignore failures (e.g. autoplay policies).
  }
}
