import { describe, expect, it } from 'vitest'
import {
  BREACH_R, DIFFS, MAX_T, REF, ack, classify, clusterOf, decide, generate, isFinished, isVisible, loadHist, newSim, saveHist, score, step,
  type Cls, type Dec, type Params, type Sim, type Track,
} from '../src/sim'

const PRESETS: Params[] = [
  { name: 'Urban Perimeter', env: 'Urban', time: 'Day', sensor: 'Clear', type: 'Single', diff: 0 },
  { name: 'Night Intrusion', env: 'Rural', time: 'Night', sensor: 'Moderate', type: 'Multiple', diff: 1 },
  { name: 'Swarm Breach', env: 'Mixed', time: 'Day', sensor: 'Degraded', type: 'Swarm', diff: 2 },
  { name: 'Chaos Vector', env: 'Urban', time: 'Night', sensor: 'Degraded', type: 'Swarm', diff: 3 },
]
const ALL: Params[] = []
for (const type of ['Single', 'Multiple', 'Swarm']) for (const sensor of ['Clear', 'Moderate', 'Degraded']) for (let diff = 0; diff < 4; diff++) ALL.push({ name: 'x', env: ['Urban', 'Rural', 'Mixed'][diff % 3], time: diff % 2 ? 'Night' : 'Day', sensor, type, diff })

type Policy = {
  classify: (k: Track, s: Sim) => Cls | null
  decide: (k: Track, s: Sim) => Dec | null
  reactAfter?: number // seconds after appearance before acting
  group?: boolean
  /** which cluster members the operator keeps selected (a real operator shift-clicks the odd one out) */
  same?: (a: Track, b: Track) => boolean
}
/** Plays a scenario with a scripted operator. Returns the score plus how many "clicks" the operator needed. */
function play(seed: number, p: Params, pol: Policy, dt = 1 / 30) {
  const sim = newSim(generate(p, seed))
  let clicks = 0
  const react = pol.reactAfter ?? 3
  while (!isFinished(sim) && sim.t < MAX_T) {
    step(sim, dt)
    for (const k of sim.tracks) {
      if (!isVisible(sim, k) || sim.t - k.appear < react) continue
      if (k.cls === undefined) {
        const c = pol.classify(k, sim)
        if (!c) continue
        const ids = pol.group ? clusterOf(sim, k.id).filter(id => (pol.same ?? (() => true))(k, sim.tracks.find(t => t.id === id)!)) : [k.id]
        ack(sim, ids); classify(sim, ids, c); clicks += 2
        for (const id of ids) { const o = sim.tracks.find(t => t.id === id)!; o.clsAt = sim.t }
      } else if (k.dec === undefined && sim.t - (k.clsAt ?? 0) > 0.6) {
        const d = pol.decide(k, sim)
        if (!d) continue
        const ids = pol.group ? clusterOf(sim, k.id).filter(id => { const o = sim.tracks.find(t => t.id === id)!; return o.cls === k.cls && (pol.same ?? (() => true))(k, o) }) : [k.id]
        decide(sim, ids, d); clicks += 1
      }
    }
  }
  return { sim, r: score(sim), clicks }
}

const perfect: Policy = { classify: k => k.truth, decide: k => REF[k.truth], group: true, same: (a, b) => a.truth === b.truth }
const behaviourAware: Policy = {
  group: true, reactAfter: 5, same: (a, b) => (a.altitude >= 150) === (b.altitude >= 150),
  classify: (k, s) => (k.altitude >= 150 ? 'FRIENDLY' : clusterOf(s, k.id).length >= 3 ? 'HOSTILE_SWARM' : 'HOSTILE_SINGLE'),
  decide: (k, s) => (k.cls === 'FRIENDLY' ? 'MONITOR' : k.cls === 'HOSTILE_SWARM' ? 'SIM_ENGAGE' : 'ALERT'),
}
const iffOnly: Policy = { classify: k => (k.iff === 'VALID' ? 'FRIENDLY' : 'HOSTILE_SINGLE'), decide: k => (k.cls === 'FRIENDLY' ? 'MONITOR' : 'ALERT') }
const passive: Policy = { classify: k => k.truth, decide: () => 'MONITOR' }
const idle: Policy = { classify: () => null, decide: () => null }
const friendlyFire: Policy = { classify: k => k.truth, decide: k => (k.truth === 'FRIENDLY' ? 'SIM_ENGAGE' : REF[k.truth]), group: true, same: (a, b) => a.truth === b.truth }

describe('scenario generation', () => {
  it('never leaks ground truth through the track id, and ids are unique', () => {
    for (let seed = 1; seed <= 200; seed++) for (const p of ALL) {
      const sc = generate(p, seed * 7919)
      const ids = sc.tracks.map(k => k.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const k of sc.tracks) expect(k.id).toMatch(/^TRK-\d{3,4}$/)
    }
  })
  it('does not always make the first track hostile (no ordering pattern)', () => {
    let hostileFirst = 0, friendlyFirst = 0
    for (let seed = 1; seed <= 300; seed++) {
      const sc = generate({ name: 'x', env: 'Rural', time: 'Day', sensor: 'Clear', type: 'Multiple', diff: 2 }, seed)
      const first = [...sc.tracks].sort((a, b) => a.appear - b.appear)[0]
      first.truth === 'FRIENDLY' ? friendlyFirst++ : hostileFirst++
    }
    expect(friendlyFirst).toBeGreaterThan(40)
    expect(hostileFirst).toBeGreaterThan(40)
  })
  it('is reproducible: same seed gives identical scenario and identical scripted outcome', () => {
    const a = play(424242, PRESETS[2], perfect), b = play(424242, PRESETS[2], perfect)
    expect(a.r).toEqual(b.r)
    expect(generate(PRESETS[1], 99).tracks.map(k => [k.id, k.truth, k.appear])).toEqual(generate(PRESETS[1], 99).tracks.map(k => [k.id, k.truth, k.appear]))
  })
  it('produces no NaN/Infinity anywhere after a full run, including stress sizes', () => {
    for (const p of ALL) {
      const sim = newSim(generate(p, 5))
      for (let i = 0; i < 3600; i++) step(sim, 1 / 30)
      for (const k of sim.tracks) for (const v of [k.x, k.y, k.vx, k.vy, k.dx, k.dy, k.heading]) expect(Number.isFinite(v)).toBe(true)
    }
    const big = newSim(generate({ name: 's', env: 'Urban', time: 'Night', sensor: 'Degraded', type: 'Swarm', diff: 3 }, 9, 500))
    for (let i = 0; i < 600; i++) step(big, 1 / 60)
    for (const k of big.tracks) expect(Number.isFinite(k.x + k.y)).toBe(true)
  })
})

describe('observable cues make classification learnable but not trivial', () => {
  it('IFF alone is unreliable (spoofing), behaviour-aware play is reliable', () => {
    let iffRight = 0, behRight = 0, total = 0
    for (let seed = 1; seed <= 60; seed++) for (const p of PRESETS) {
      const a = play(seed * 31, p, iffOnly), b = play(seed * 31, p, behaviourAware)
      for (const k of a.sim.tracks) if (!k.ghost) { total++; if (k.cls === k.truth) iffRight++ }
      for (const k of b.sim.tracks) if (!k.ghost && k.cls === k.truth) behRight++
    }
    const iff = iffRight / total, beh = behRight / total
    console.log(`classification accuracy over ${total} tracks · IFF-only ${(iff * 100).toFixed(0)}% · behaviour-aware ${(beh * 100).toFixed(0)}%`)
    expect(iff).toBeLessThan(0.75)
    expect(beh).toBeGreaterThan(0.9)
  })
  it('friendlies hold a steady orbit and never breach; hostiles close on the observer', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const sim = newSim(generate(PRESETS[1], seed))
      let minFriendlyR = 1e9
      for (let i = 0; i < 30 * 60; i++) { step(sim, 1 / 30); for (const k of sim.tracks) if (k.truth === 'FRIENDLY' && !k.ghost && k.status === 'ACTIVE' && sim.t >= k.appear) minFriendlyR = Math.min(minFriendlyR, Math.hypot(k.x, k.y)) }
      expect(minFriendlyR).toBeGreaterThan(BREACH_R * 3)
    }
  })
})

describe('cluster selection and kinematics', () => {
  it('cluster-select rarely sweeps a friendly into a swarm cluster', () => {
    let clusters = 0, impure = 0
    for (let seed = 1; seed <= 80; seed++) for (const p of PRESETS.slice(2)) {
      const sim = newSim(generate(p, seed * 3))
      for (let i = 0; i < 30 * 40; i++) {
        step(sim, 1 / 30)
        if (i % 30 === 0) for (const k of sim.tracks) if (k.truth === 'HOSTILE_SWARM' && isVisible(sim, k)) { clusters++; if (clusterOf(sim, k.id).some(id => sim.tracks.find(t => t.id === id)!.truth !== 'HOSTILE_SWARM')) impure++ }
      }
    }
    console.log(`cluster impurity: ${impure}/${clusters} swarm cluster selections included a non-swarm track (${((impure / clusters) * 100).toFixed(1)}%)`)
    expect(impure / clusters).toBeLessThan(0.1)
  })
  it('actual ground speed of every track matches its displayed speed within 25%', () => {
    for (let seed = 1; seed <= 30; seed++) for (const p of PRESETS) {
      const sim = newSim(generate(p, seed)); const prev: Record<string, [number, number, number]> = {}
      for (let i = 0; i < 30 * 50; i++) {
        step(sim, 1 / 30)
        if (i % 30 === 0) { for (const k of sim.tracks) { if (!isVisible(sim, k) || k.ghost) continue; const o = prev[k.id]; if (o && i > 30 * 20) { const v = Math.hypot(k.x - o[0], k.y - o[1]) / (sim.t - o[2]); expect(Math.abs(v - k.su) / k.su).toBeLessThan(0.25) } prev[k.id] = [k.x, k.y, sim.t] } }
      }
    }
  })
})

describe('time budget: every preset is winnable, including swarms (via cluster actions)', () => {
  it('perfect operator clears all presets with no breach; reports clicks and slack', () => {
    for (const p of PRESETS) {
      let worstScore = 100, maxClicks = 0, breaches = 0
      for (let seed = 1; seed <= 40; seed++) { const o = play(seed * 13, p, perfect); worstScore = Math.min(worstScore, o.r.overall); maxClicks = Math.max(maxClicks, o.clicks); breaches += o.r.breaches }
      console.log(`${p.name.padEnd(16)} worst perfect-play score ${worstScore} · max clicks ${maxClicks} · breaches ${breaches}`)
      expect(breaches).toBe(0)
      expect(worstScore).toBeGreaterThanOrEqual(85)
    }
  })
  it('a human-speed operator (5 s reaction) still passes the hardest preset', () => {
    let pass = 0
    for (let seed = 1; seed <= 40; seed++) if (play(seed * 17, PRESETS[3], { ...behaviourAware, reactAfter: 5 }).r.ok) pass++
    console.log(`Chaos Vector with 5 s reaction: ${pass}/40 passed`)
    expect(pass).toBeGreaterThan(24)
  })
})

describe('scoring and consequences', () => {
  it('idle play fails hard', () => { for (const p of PRESETS) expect(play(11, p, idle).r.overall).toBeLessThan(35) })
  it('passive play (classify right, MONITOR everything) no longer passes: hostiles keep coming and breach', () => {
    for (const p of PRESETS.slice(0, 3)) {
      const o = play(77, p, passive)
      console.log(`${p.name}: passive score ${o.r.overall}, breaches ${o.r.breaches}, ok=${o.r.ok}`)
      expect(o.r.ok).toBe(false)
      expect(o.r.breaches).toBeGreaterThan(0)
    }
  })
  it('engaging a friendly is a critical failure: capped below the pass mark and flagged', () => {
    let hit = 0
    for (let seed = 1; seed <= 60; seed++) {
      const good = play(seed, PRESETS[1], perfect), bad = play(seed, PRESETS[1], friendlyFire)
      if (bad.r.fratricides > 0) { hit++; expect(bad.r.ok).toBe(false); expect(bad.r.overall).toBeLessThanOrEqual(49); expect(good.r.overall - bad.r.overall).toBeGreaterThan(30) }
    }
    expect(hit).toBeGreaterThan(20)
  })
  it('first classification is committed; repeated and mixed clicks are no-ops', () => {
    const sim = newSim(generate(PRESETS[0], 3)); const k = sim.tracks[0]
    while (sim.t < k.appear + 0.5) step(sim, 1 / 30)
    classify(sim, [k.id], 'HOSTILE_SINGLE'); const t0 = k.clsAt
    classify(sim, [k.id], 'FRIENDLY'); classify(sim, [k.id], 'UNKNOWN')
    expect(k.cls).toBe('HOSTILE_SINGLE'); expect(k.clsAt).toBe(t0)
  })
  it('a decision before classification is ignored; ALERT on a swarm member does not neutralise it', () => {
    const sim = newSim(generate(PRESETS[2], 21))
    const sw = sim.tracks.find(k => k.truth === 'HOSTILE_SWARM')!
    while (sim.t < sw.appear + 0.5) step(sim, 1 / 30)
    decide(sim, [sw.id], 'SIM_ENGAGE'); expect(sw.dec).toBeUndefined()
    const untilVisible = () => { for (let i = 0; i < 300 && !isVisible(sim, sw); i++) step(sim, 1 / 30) } // actions on a dropped-out track are ignored by design
    untilVisible(); classify(sim, [sw.id], 'HOSTILE_SWARM'); untilVisible(); decide(sim, [sw.id], 'ALERT')
    expect(sw.engageAt).toBeUndefined() // under-response: no neutralisation scheduled
    untilVisible(); decide(sim, [sw.id], 'SIM_ENGAGE')
    expect(sw.engageAt).toBeDefined()
    for (let i = 0; i < 30 * 3; i++) step(sim, 1 / 30)
    expect(sw.status).toBe('NEUTRALISED')
  })
  it('clamps to 0..100 and never returns NaN', () => {
    for (const p of ALL) for (const pol of [perfect, idle, passive, friendlyFire]) { const r = play(4, p, pol).r; for (const v of Object.values(r)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true); expect(r.overall).toBeGreaterThanOrEqual(0); expect(r.overall).toBeLessThanOrEqual(100) }
  })
  it('spamming random actions on random tracks every frame never throws and never corrupts state', () => {
    const sim = newSim(generate(PRESETS[3], 8)); let seed = 1
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const CL: Cls[] = ['FRIENDLY', 'UNKNOWN', 'HOSTILE_SINGLE', 'HOSTILE_SWARM'], DC: Dec[] = ['MONITOR', 'INVESTIGATE', 'ALERT', 'SIM_ENGAGE']
    for (let i = 0; i < 30 * 130 && !isFinished(sim); i++) {
      step(sim, 1 / 30)
      for (let j = 0; j < 5; j++) { const id = sim.tracks[Math.floor(rnd() * sim.tracks.length)].id; ack(sim, [id]); classify(sim, [id], CL[Math.floor(rnd() * 4)]); decide(sim, clusterOf(sim, id), DC[Math.floor(rnd() * 4)]) }
    }
    const r = score(sim); expect(Number.isFinite(r.overall)).toBe(true)
    expect(sim.tracks.every(k => !(k.status === 'FRATRICIDE' && k.truth !== 'FRIENDLY'))).toBe(true)
  })
})


describe('sound-effect events', () => {
  const drain = (sim: Sim) => sim.sfx.splice(0)
  it('emits contact, classify, decide, neutralised in order for a normal engagement', () => {
    const sim = newSim(generate(PRESETS[0], 3)); const k = sim.tracks[0]; const seen: string[] = []
    while (sim.t < k.appear + 0.5) { step(sim, 1 / 30); seen.push(...drain(sim)) }
    expect(seen).toContain('contact')
    classify(sim, [k.id], 'HOSTILE_SINGLE'); expect(drain(sim)).toEqual(['classify'])
    decide(sim, [k.id], 'ALERT'); expect(drain(sim)).toEqual(['decide'])
    for (let i = 0; i < 30 * 6; i++) step(sim, 1 / 30)
    expect(drain(sim)).toContain('neutralised')
  })
  it('repeated or ignored actions emit no sound', () => {
    const sim = newSim(generate(PRESETS[0], 3)); const k = sim.tracks[0]
    while (sim.t < k.appear + 0.5) step(sim, 1 / 30); drain(sim)
    decide(sim, [k.id], 'ALERT'); expect(drain(sim)).toEqual([]) // not classified yet
    classify(sim, [k.id], 'FRIENDLY'); drain(sim)
    classify(sim, [k.id], 'UNKNOWN'); expect(drain(sim)).toEqual([]) // already committed
  })
  it('friendly fire sounds the fratricide buzzer (and not the cheerful decide chime)', () => {
    for (let seed = 1; seed < 40; seed++) {
      const sim = newSim(generate(PRESETS[1], seed)); const f = sim.tracks.find(t => t.truth === 'FRIENDLY'); if (!f) continue
      while (sim.t < f.appear + 0.5 || !isVisible(sim, f)) step(sim, 1 / 30); drain(sim)
      classify(sim, [f.id], 'FRIENDLY'); drain(sim); decide(sim, [f.id], 'SIM_ENGAGE')
      const out = drain(sim); expect(out).toContain('fratricide'); expect(out).not.toContain('decide'); return
    }
    throw new Error('no scenario with a friendly found')
  })
  it('engaging sensor clutter sounds the false-alarm tone; hostiles breaching sound the breach alarm', () => {
    const g = newSim(generate({ name: 'x', env: 'Rural', time: 'Day', sensor: 'Degraded', type: 'Single', diff: 3 }, 5)); const ghost = g.tracks.find(t => t.ghost)!
    while (g.t < ghost.appear + 0.3 || !isVisible(g, ghost)) step(g, 1 / 30); drain(g)
    classify(g, [ghost.id], 'HOSTILE_SINGLE'); drain(g); decide(g, [ghost.id], 'ALERT'); expect(drain(g)).toContain('falseAlarm')
    const b = newSim(generate(PRESETS[0], 4)); const seen: string[] = []
    for (let i = 0; i < 30 * 70; i++) { step(b, 1 / 30); seen.push(...drain(b)) }
    expect(seen).toContain('breach')
  })
  it('the event queue is bounded even if nobody drains it', () => {
    const sim = newSim(generate({ name: 's', env: 'Urban', time: 'Night', sensor: 'Degraded', type: 'Swarm', diff: 3 }, 9, 300))
    for (let i = 0; i < 30 * 40; i++) step(sim, 1 / 30)
    expect(sim.sfx.length).toBeLessThanOrEqual(40)
  })
})

describe('history storage never crashes the app', () => {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const restore = () => { if (orig) Object.defineProperty(globalThis, 'localStorage', orig); else delete (globalThis as any).localStorage }
  it('survives blocked, throwing and corrupted storage', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('SecurityError') }, setItem() { throw new Error('QuotaExceeded') } } })
    expect(loadHist()).toEqual([]); expect(() => saveHist([])).not.toThrow()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => '{not json', setItem() {} } })
    expect(loadHist()).toEqual([])
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify([{ overall: 'x' }, null, 5, { overall: 80, ts: 1, avg: 3 }]), setItem() {} } })
    expect(loadHist()).toHaveLength(1)
    restore()
  })
})
void DIFFS
