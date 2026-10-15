// AEGIS-X sound alerts. Everything is synthesised with the Web Audio API: no audio files, no network, no licences.
//  - Browsers block audio until a user gesture, so the context is created/resumed in unlock() (called from the first click/key).
//  - Every call is wrapped so a missing/blocked AudioContext can never break the simulation (sound is purely additive:
//    each event is also shown as text in the event log and as a visual flash).
//  - The mute preference is persisted; repeated sounds are throttled so an 8-drone swarm arriving does not become noise.
import type { Sfx } from './sim'

type Tone = { f: number; t: number; d: number; type?: OscillatorType; g?: number; slideTo?: number }
const MASTER = 0.22 // overall loudness (0..1). Deliberately modest: this is a training tool, not an alarm clock.

const SFX: Record<Sfx, Tone[]> = {
  contact: [{ f: 880, t: 0, d: 0.07, g: 0.55 }],
  classify: [{ f: 620, t: 0, d: 0.05, type: 'triangle', g: 0.55 }],
  decide: [{ f: 440, t: 0, d: 0.06, type: 'triangle' }, { f: 660, t: 0.07, d: 0.09, type: 'triangle' }],
  neutralised: [{ f: 523, t: 0, d: 0.1 }, { f: 784, t: 0.11, d: 0.2 }],
  breach: [{ f: 220, t: 0, d: 0.26, type: 'square', g: 0.6 }, { f: 165, t: 0.3, d: 0.4, type: 'square', g: 0.6 }],
  fratricide: [{ f: 330, t: 0, d: 0.55, type: 'sawtooth', slideTo: 110, g: 0.6 }],
  falseAlarm: [{ f: 300, t: 0, d: 0.2, type: 'triangle', g: 0.7 }],
  complete: [{ f: 392, t: 0, d: 0.12 }, { f: 523, t: 0.13, d: 0.12 }, { f: 659, t: 0.26, d: 0.24 }],
}
/** minimum gap (ms) between two plays of the same sound */
const GAP: Record<Sfx, number> = { contact: 180, classify: 60, decide: 80, neutralised: 120, breach: 500, fratricide: 800, falseAlarm: 300, complete: 1000 }

const KEY = 'aegis_sound_v1'
let ctx: AudioContext | null = null
let master: GainNode | null = null
const lastAt: Partial<Record<Sfx, number>> = {}
const listeners = new Set<() => void>()

const readMuted = () => { try { return localStorage.getItem(KEY) === 'muted' } catch { return false } }
let muted = readMuted()

export const isMuted = () => muted
export function setMuted(m: boolean) {
  muted = m
  try { localStorage.setItem(KEY, m ? 'muted' : 'on') } catch { /* storage blocked: preference lasts for this page view */ }
  listeners.forEach(l => l())
}
export const toggleMuted = () => setMuted(!muted)
/** for React's useSyncExternalStore */
export function subscribeMute(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }

/** Test helper: forget throttle history (the real clock never resets, but fake test clocks do). */
export function resetThrottle() { for (const k of Object.keys(lastAt) as Sfx[]) delete lastAt[k] }

/** Call from any user gesture (click/key). Idempotent and cheap. */
export function unlock() {
  try {
    if (!ctx) {
      const AC: typeof AudioContext | undefined = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined
      if (!AC) return
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = MASTER
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
  } catch { ctx = null; master = null }
}

export function play(s: Sfx) {
  if (muted || !ctx || !master) return // before the first gesture there is no context: silently skip
  try {
    const now = performance.now() // monotonic; a backwards clock jump (dt < 0) never blocks sound
    const dt = now - (lastAt[s] ?? -Infinity)
    if (dt >= 0 && dt < GAP[s]) return
    lastAt[s] = now
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const t0 = ctx.currentTime
    for (const tone of SFX[s]) {
      const osc = ctx.createOscillator(), g = ctx.createGain()
      const start = t0 + tone.t, end = start + tone.d, peak = tone.g ?? 0.8
      osc.type = tone.type ?? 'sine'
      osc.frequency.setValueAtTime(tone.f, start)
      if (tone.slideTo) osc.frequency.exponentialRampToValueAtTime(tone.slideTo, end)
      g.gain.setValueAtTime(0.0001, start) // 5 ms attack and exponential release: no clicks or pops
      g.gain.linearRampToValueAtTime(peak, start + 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, end)
      osc.connect(g); g.connect(master)
      osc.start(start); osc.stop(end + 0.02)
    }
  } catch { /* never let audio break the simulation */ }
}
