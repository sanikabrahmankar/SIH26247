// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Call = [string, ...number[]]
const made = { ctx: 0, osc: 0, resumed: 0, ramps: [] as Call[], freqRamps: [] as Call[] }
class FakeParam {
  value = 0
  setValueAtTime(...a: number[]) { void a }
  linearRampToValueAtTime(...a: number[]) { void a }
  exponentialRampToValueAtTime(...a: number[]) { made.ramps.push(['exp', ...a]) }
}
class FakeFreq extends FakeParam { exponentialRampToValueAtTime(...a: number[]) { made.freqRamps.push(['exp', ...a]) } }
class FakeAC {
  state: 'suspended' | 'running' = 'suspended'; currentTime = 0; destination = {}
  constructor() { made.ctx++ }
  resume() { made.resumed++; this.state = 'running'; return Promise.resolve() }
  createGain() { return { gain: new FakeParam(), connect() {} } }
  createOscillator() { made.osc++; return { type: 'sine', frequency: new FakeFreq(), connect() {}, start() {}, stop() {} } }
}
const fresh = async () => { vi.resetModules(); return import('../src/audio') }
const install = (C: unknown) => { (window as unknown as { AudioContext?: unknown }).AudioContext = C }

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] }); vi.setSystemTime(1_000_000); made.ctx = made.osc = made.resumed = 0; made.ramps = []; made.freqRamps = []; localStorage.clear(); install(FakeAC) })
afterEach(() => { vi.useRealTimers(); install(undefined) })

describe('sound alerts', () => {
  it('is a silent no-op when the browser has no AudioContext', async () => {
    install(undefined); const a = await fresh()
    expect(() => { a.unlock(); a.play('breach') }).not.toThrow(); expect(made.ctx).toBe(0)
  })
  it('does not play before the first user gesture (autoplay policy), then plays after unlock()', async () => {
    const a = await fresh()
    a.play('neutralised'); expect(made.osc).toBe(0)
    a.unlock(); a.unlock(); a.unlock()
    expect(made.ctx).toBe(1); expect(made.resumed).toBeGreaterThanOrEqual(1) // idempotent
    a.play('neutralised'); expect(made.osc).toBe(2)
  })
  it('each sound has the expected number of tones', async () => {
    const a = await fresh(); a.unlock()
    const counts: Record<string, number> = { contact: 1, classify: 1, decide: 2, neutralised: 2, breach: 2, fratricide: 1, falseAlarm: 1, complete: 3 }
    for (const [name, n] of Object.entries(counts)) { made.osc = 0; vi.advanceTimersByTime(5000); a.play(name as never); expect(made.osc, name).toBe(n) }
  })
  it('never ramps a gain or frequency to 0 or below (exponential ramps to 0 throw RangeError in real browsers)', async () => {
    const a = await fresh(); a.unlock()
    for (const n of ['contact', 'classify', 'decide', 'neutralised', 'breach', 'fratricide', 'falseAlarm', 'complete']) { vi.advanceTimersByTime(5000); a.play(n as never) }
    expect(made.ramps.length).toBeGreaterThan(8); expect(made.freqRamps.length).toBeGreaterThan(0)
    for (const r of [...made.ramps, ...made.freqRamps]) expect(r[1]).toBeGreaterThan(0)
  })
  it('throttles repeats so a swarm arriving does not become noise', async () => {
    const a = await fresh(); a.unlock()
    for (let i = 0; i < 8; i++) a.play('contact')
    expect(made.osc).toBe(1)
    vi.advanceTimersByTime(200); a.play('contact'); expect(made.osc).toBe(2)
  })
  it('a backwards clock jump (NTP sync, manual change) never leaves sounds stuck throttled', async () => {
    const a = await fresh(); a.unlock()
    vi.advanceTimersByTime(60_000); a.play('breach'); expect(made.osc).toBe(2)
    const spy = vi.spyOn(performance, 'now').mockReturnValue(5) // clock went back by a minute
    a.play('breach'); expect(made.osc).toBe(4); spy.mockRestore()
  })
  it('mute silences everything, is persisted, and survives a reload; unmute restores', async () => {
    let a = await fresh(); a.unlock(); a.setMuted(true)
    a.play('breach'); expect(made.osc).toBe(0)
    expect(localStorage.getItem('aegis_sound_v1')).toBe('muted')
    a = await fresh(); expect(a.isMuted()).toBe(true); a.unlock(); a.play('breach'); expect(made.osc).toBe(0)
    a.toggleMuted(); expect(a.isMuted()).toBe(false); a.play('breach'); expect(made.osc).toBe(2)
  })
  it('notifies subscribers on toggle and stops after unsubscribe', async () => {
    const a = await fresh(); const cb = vi.fn(); const off = a.subscribeMute(cb)
    a.toggleMuted(); expect(cb).toHaveBeenCalledTimes(1); off(); a.toggleMuted(); expect(cb).toHaveBeenCalledTimes(1)
  })
  it('survives a throwing AudioContext constructor, blocked storage and failing nodes', async () => {
    install(class { constructor() { throw new Error('NotAllowedError') } })
    const a = await fresh(); expect(() => { a.unlock(); a.play('breach') }).not.toThrow()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota') })
    const b = await fresh(); expect(b.isMuted()).toBe(false); expect(() => b.setMuted(true)).not.toThrow()
    install(class extends FakeAC { createOscillator(): never { throw new Error('boom') } })
    const c = await fresh(); c.unlock(); expect(() => c.play('decide')).not.toThrow()
  })
})
