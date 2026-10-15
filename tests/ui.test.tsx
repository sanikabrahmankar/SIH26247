// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MutableRefObject } from 'react'
import type { Sim } from '../src/sim'

vi.mock('react-chartjs-2', () => ({ Line: () => <div data-testid="trend-chart" /> }))
vi.mock('../src/audio', async importOriginal => { const m = await importOriginal<typeof import('../src/audio')>(); return { ...m, unlock: vi.fn(m.unlock) } })
import * as audio from '../src/audio'
import App from '../src/App'

// fake Web Audio + download plumbing (jsdom has neither)
const audioMade = { osc: 0 }
class FakeParam { value = 0; setValueAtTime() {} linearRampToValueAtTime() {} exponentialRampToValueAtTime() {} }
class FakeAC {
  state = 'running'; currentTime = 0; destination = {}
  resume() { return Promise.resolve() }
  createGain() { return { gain: new FakeParam(), connect() {} } }
  createOscillator() { audioMade.osc++; return { type: 'sine', frequency: new FakeParam(), connect() {}, start() {}, stop() {} } }
}
class FakeBlob { constructor(public parts: string[], public opts?: unknown) {} get text() { return this.parts.join('') } }
let blobs: FakeBlob[] = [], downloads: string[] = []

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root, host: HTMLElement
let rafQ: FrameRequestCallback[] = []
let size = { w: 600, h: 600 }
const noopCtx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, p) => (p in t ? t[p] : () => ({ addColorStop() {} })),
  set: (t, p, v) => { t[p] = v; return true },
})

const screenText = () => host.textContent ?? ''
const btn = (label: string | RegExp) => [...host.querySelectorAll('button')].find(b => (typeof label === 'string' ? b.textContent?.includes(label) : label.test(b.textContent ?? ''))) as HTMLButtonElement | undefined
const byId = (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null
const click = (el: Element | null | undefined) => { if (!el) throw new Error('element not found'); act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) }) }
const sim = () => (window as unknown as { __aegis: { simRef: MutableRefObject<Sim> } }).__aegis.simRef.current
/** advances wall clock and runs every queued requestAnimationFrame callback at ~60 fps */
const run = (ms: number) => { for (let t = 0; t < ms; t += 16) act(() => { vi.advanceTimersByTime(16); const q = rafQ; rafQ = []; q.forEach(cb => cb(performance.now())) }) }
const pickTrack = (id: string) => {
  const k = sim().tracks.find(t => t.id === id)!, s = Math.min(size.w, size.h) / 2 / 108
  const canvas = host.querySelector('canvas')!
  act(() => { canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: size.w / 2 + k.dx * s, clientY: size.h / 2 + k.dy * s })) })
}
const keydown = (key: string) => act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })

function startSim(preset = 'URBAN PERIMETER') {
  click(btn('START SIMULATION')); click(btn(preset)); click(btn('INITIALIZE SIMULATION'))
}
function firstVisible() {
  run(9000)
  const s = sim(), k = s.tracks.find(t => !t.ghost && s.t >= t.appear && t.status === 'ACTIVE' && s.t >= t.lostUntil)
  if (!k) throw new Error('no visible track')
  return k
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
  rafQ = []; size = { w: 600, h: 600 }
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafQ.push(cb); return rafQ.length })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(noopCtx as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: size.w, bottom: size.h, width: size.w, height: size.h, x: 0, y: 0, toJSON() {} }))
  // deterministic scenario seeds: a random seed could put a sensor dropout (buttons correctly disabled, 'SIGNAL LOST') on a click and make tests flaky
  let rs = 987654321; vi.spyOn(Math, 'random').mockImplementation(() => (rs = (rs * 48271) % 2147483647) / 2147483647)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeAC
  audio.setMuted(false); audio.resetThrottle(); audioMade.osc = 0; vi.mocked(audio.unlock).mockClear()
  blobs = []; downloads = []
  vi.stubGlobal('Blob', FakeBlob)
  URL.createObjectURL = vi.fn((b: unknown) => { blobs.push(b as FakeBlob); return 'blob:fake' })
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = () => {}
  localStorage.clear()
  window.history.pushState({}, '', '/?debug')
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (URL as unknown as Record<string, unknown>).createObjectURL; delete (URL as unknown as Record<string, unknown>).revokeObjectURL })
const mount = () => act(() => { root.render(<App />) })

describe('startup resilience', () => {
  it('renders when localStorage throws (blocked storage / private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    expect(() => mount()).not.toThrow()
    expect(screenText()).toContain('TRAIN. DETECT. DECIDE. RESPOND.')
  })
  it('renders when stored history is corrupted, and shows an honest empty state (no fabricated sessions)', () => {
    localStorage.setItem('aegis_hist_v2', '{broken'); localStorage.setItem('aegis_session_hist', '[{"overall":87}]')
    mount()
    expect(screenText()).toContain('TRAINING HISTORY: 0 sessions')
    expect(screenText()).toMatch(/Sessions Completed0/)
  })
})

describe('decision interface under abuse', () => {
  beforeEach(() => { mount(); startSim() })

  it('a fast double-click on a class button cannot also trigger a response (same-slot bug)', () => {
    const k = firstVisible(); pickTrack(k.id)
    expect(byId('cls-HOSTILE_SWARM')).not.toBeNull()
    click(byId('cls-HOSTILE_SWARM'))
    expect(k.cls).toBe('HOSTILE_SWARM')
    // the response grid now occupies the same screen slot; the second click of a double-click lands on it
    click(byId('dec-SIM_ENGAGE')); keydown('4') // button click and keyboard path
    expect(k.dec).toBeUndefined()
    run(600)
    click(byId('dec-SIM_ENGAGE'))
    expect(k.dec).toBe('SIM_ENGAGE')
  })

  it('spam-clicking classes and responses commits only the first of each', () => {
    const k = firstVisible(); pickTrack(k.id)
    click(byId('cls-FRIENDLY')); keydown('3'); keydown('4') // after the first commit the class grid is gone; key presses inside the lock window are ignored
    expect(k.cls).toBe('FRIENDLY'); expect(k.dec).toBeUndefined()
    run(600)
    click(byId('dec-MONITOR'))
    const at = k.decAt
    for (const id of ['dec-SIM_ENGAGE', 'dec-ALERT', 'dec-INVESTIGATE']) click(byId(id))
    expect(k.dec).toBe('MONITOR'); expect(k.decAt).toBe(at)
    expect(sim().fratricides).toBe(0)
  })

  it('selecting a blank area clears selection; clicking far from every blip never selects', () => {
    const k = firstVisible(); pickTrack(k.id)
    expect(screenText()).toContain(k.id + 'CLUSTER'.slice(0, 0))
    act(() => { host.querySelector('canvas')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 2, clientY: 2 })) })
    expect(screenText()).toContain('Select a track on the radar')
  })

  it('actions are ignored while paused', () => {
    const k = firstVisible(); pickTrack(k.id); click(byId('cls-HOSTILE_SINGLE')); run(600)
    keydown(' '); expect(sim().paused).toBe(true)
    keydown('3'); expect(k.dec).toBeUndefined()
    keydown(' '); expect(sim().paused).toBe(false)
    keydown('3'); expect(k.dec).toBe('ALERT')
  })
})

describe('tab switching, blur, resize', () => {
  beforeEach(() => { mount(); startSim() })

  it('hiding the tab freezes the clock, shows PAUSED, and resumes on demand without penalty', () => {
    run(3000)
    const t0 = sim().t
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(sim().paused).toBe(true)
    run(20000)
    expect(sim().t).toBe(t0)
    expect(screenText()).toContain('PAUSED')
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    click(btn(/PAUSED/)); expect(sim().paused).toBe(false)
    run(1000); expect(sim().t).toBeGreaterThan(t0)
    expect(sim().tracks.every(k => k.status === 'ACTIVE')).toBe(true) // nothing breached while away
  })

  it('window blur pauses too', () => {
    run(1000); act(() => { window.dispatchEvent(new Event('blur')) }); expect(sim().paused).toBe(true)
  })

  it('window resize re-measures the canvas backing store', () => {
    run(200)
    const c = host.querySelector('canvas')!
    expect(c.width).toBe(600)
    size = { w: 320, h: 320 }
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(c.width).toBe(320); expect(c.height).toBe(320)
    size = { w: 0, h: 0 }  // hidden / collapsed container must not zero the canvas or throw
    expect(() => act(() => { window.dispatchEvent(new Event('resize')) })).not.toThrow()
    expect(c.width).toBe(320)
  })
})

describe('navigation edge cases', () => {
  it('aborting mid-run then letting timers elapse never teleports to the AAR or logs a session', () => {
    mount(); startSim(); run(2000)
    click(btn('END MISSION'))        // schedules the 900 ms completion timer
    click(btn(/AEGIS-X/))            // operator clicks the logo before it fires (confirm -> true)
    expect(screenText()).toContain('TRAIN. DETECT. DECIDE. RESPOND.')
    run(3000); act(() => { vi.advanceTimersByTime(5000) })
    expect(screenText()).toContain('TRAIN. DETECT. DECIDE. RESPOND.')
    expect(screenText()).toContain('TRAINING HISTORY: 0 sessions')
  })
  it('declining the abort confirmation keeps the run going', () => {
    mount(); startSim(); run(1000)
    ;(window.confirm as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const t0 = sim().t
    click(btn(/AEGIS-X/)); run(500)
    expect(screenText()).toContain('THREAT INTELLIGENCE'); expect(sim().t).toBeGreaterThan(t0)
  })
})

describe('full session → AAR → persistence', () => {
  it('completes, scores, saves, survives a reload, and replays the same seed', () => {
    mount(); startSim('NIGHT INTRUSION')
    const k = firstVisible(); pickTrack(k.id); click(byId('cls-UNKNOWN')); run(600); click(byId('dec-INVESTIGATE'))
    click(btn('END MISSION')); run(1200)
    expect(screenText()).toContain('AFTER-ACTION REVIEW')
    expect(screenText()).toMatch(/OBJECTIVE|TRAINING OBJECTIVE/)
    expect(screenText()).toContain('WHAT-IF REPLAY')
    expect(screenText()).not.toMatch(/SWARM-\d/) // ids never encode truth
    const stored = JSON.parse(localStorage.getItem('aegis_hist_v2')!)
    expect(stored).toHaveLength(1); expect(typeof stored[0].ts).toBe('number'); expect(stored[0].scenario).toBe('Night Intrusion')
    const seed = String(stored[0].seed)
    click(btn('REPLAY SAME SEED')); expect(screenText()).toContain('SEED ' + seed)
    act(() => root.unmount()); root = createRoot(host); mount()
    expect(screenText()).toMatch(/Sessions Completed1/)
  })
  it('AFTER-ACTION REVIEW from home with no session and no history shows an empty state instead of starting a run', () => {
    mount(); click(btn('AFTER-ACTION REVIEW'))
    expect(screenText()).toContain('No sessions yet'); expect(screenText()).not.toContain('THREAT INTELLIGENCE')
  })
  it('demo data is clearly labelled and can be cleared', () => {
    mount(); click(btn('LOAD DEMO DATA'))
    expect(screenText()).toContain('TRAINING HISTORY: 5 sessions (5 demo)')
    click(btn('CLEAR HISTORY')); expect(screenText()).toContain('TRAINING HISTORY: 0 sessions')
  })
})

const toast = () => host.querySelector('[data-testid="toast"]')?.textContent ?? ''
const soundLabel = () => byId('sound-toggle')?.textContent ?? ''

describe('sound alerts in the UI', () => {
  it('any first click or key press unlocks audio (browser autoplay policy)', () => {
    mount()
    act(() => { host.firstElementChild!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
    expect(audio.unlock).toHaveBeenCalled()
  })
  it('plays during a run: classification and decisions make sound, and the sim never needs the sound to work', () => {
    mount(); startSim(); const k = firstVisible(); pickTrack(k.id)
    const before = audioMade.osc
    click(byId('cls-HOSTILE_SINGLE')); run(100)
    expect(audioMade.osc).toBeGreaterThan(before)
    const mid = audioMade.osc; run(600); click(byId('dec-ALERT')); run(100)
    expect(audioMade.osc).toBeGreaterThan(mid)
    expect(sim().sfx.length).toBe(0) // drained, not accumulating
  })
  it('M key mutes and unmutes, the header toggle follows, and the choice is persisted', () => {
    mount(); startSim()
    expect(soundLabel()).toContain('SOUND ON')
    keydown('m'); expect(soundLabel()).toContain('SOUND OFF'); expect(localStorage.getItem('aegis_sound_v1')).toBe('muted')
    const k = firstVisible(); pickTrack(k.id); const before = audioMade.osc
    click(byId('cls-HOSTILE_SINGLE')); run(200)
    expect(audioMade.osc).toBe(before) // muted: nothing plays, but the action still counted
    expect(k.cls).toBe('HOSTILE_SINGLE')
    keydown('M'); expect(soundLabel()).toContain('SOUND ON')
  })
  it('header toggle works on every screen and gives audible feedback when turning sound on', () => {
    mount()
    click(byId('sound-toggle')); expect(soundLabel()).toContain('SOUND OFF'); expect(byId('sound-toggle')!.getAttribute('aria-pressed')).toBe('false')
    act(() => { vi.advanceTimersByTime(1000) }); const before = audioMade.osc
    click(byId('sound-toggle')); expect(soundLabel()).toContain('SOUND ON'); expect(audioMade.osc).toBeGreaterThan(before)
  })
  it('mission-complete jingle plays when a run ends', () => {
    mount(); startSim(); run(500); act(() => { host.firstElementChild!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
    act(() => { vi.advanceTimersByTime(1500) }); const before = audioMade.osc
    click(btn('END MISSION')); expect(audioMade.osc).toBeGreaterThanOrEqual(before + 3)
  })
})

describe('CSV export in the UI', () => {
  it('EXPORT CSV is disabled with no history, and enabled once demo data is loaded', () => {
    mount(); expect(byId('export-history')!.disabled).toBe(true)
    click(btn('LOAD DEMO DATA')); expect(byId('export-history')!.disabled).toBe(false)
  })
  it('downloads a correctly named, BOM-prefixed CSV of the history and confirms with a toast, then releases the blob URL', () => {
    mount(); click(btn('LOAD DEMO DATA')); click(byId('export-history'))
    expect(downloads).toHaveLength(1); expect(downloads[0]).toMatch(/^aegis-x-history-\d{8}-\d{4}\.csv$/)
    const text = blobs[0].text; expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(text).toContain('session_no,completed_at_utc,scenario'); expect(text.trim().split('\r\n')).toHaveLength(6); expect(text).toContain('DEMO')
    expect(toast()).toBe('Exported 5 sessions to CSV')
    expect(URL.revokeObjectURL).not.toHaveBeenCalled(); act(() => { vi.advanceTimersByTime(1100) }); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    act(() => { vi.advanceTimersByTime(4100) }); expect(toast()).toBe('') // toast clears itself
  })
  it('after a completed session the AAR exports both the session replay and the history', () => {
    mount(); startSim('NIGHT INTRUSION')
    const k = firstVisible(); pickTrack(k.id); click(byId('cls-UNKNOWN')); run(600); click(byId('dec-INVESTIGATE')); click(btn('END MISSION')); run(1200)
    expect(screenText()).toContain('WHAT-IF REPLAY')
    click(byId('export-session'))
    expect(downloads[0]).toMatch(/^aegis-x-session-AX-[0-9A-F]{4}-[A-Z]-\d{8}-\d{4}\.csv$/)
    expect(blobs[0].text).toContain('track_id,contact_type,ground_truth'); expect(blobs[0].text).toContain(k.id); expect(toast()).toBe('Exported session replay to CSV')
    click(byId('export-history-trend'))
    expect(downloads[1]).toMatch(/^aegis-x-history-/); expect(blobs[1].text).toContain('Night Intrusion'); expect(blobs[1].text).toContain('OPERATOR')
    expect(toast()).toBe('Exported 1 session to CSV')
  })
  it('reports a blocked download instead of crashing', () => {
    mount(); click(btn('LOAD DEMO DATA'))
    URL.createObjectURL = vi.fn(() => { throw new Error('blocked') })
    expect(() => click(byId('export-history'))).not.toThrow()
    expect(toast()).toBe('Export was blocked by the browser')
  })
  it('AAR from home with history only still offers the history export', () => {
    mount(); click(btn('LOAD DEMO DATA')); click(btn('AFTER-ACTION REVIEW'))
    expect(byId('export-history-trend')!.disabled).toBe(false); click(byId('export-history-trend')); expect(downloads).toHaveLength(1)
  })
})
