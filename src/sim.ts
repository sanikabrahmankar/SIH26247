// AEGIS-X simulation core. Pure TypeScript: no React, no DOM except localStorage (guarded).
// World space: observer at (0,0), radar edge at radius R. +x = east, +y = SOUTH (screen-down), so north is -y.

export type Truth = 'FRIENDLY' | 'HOSTILE_SINGLE' | 'HOSTILE_SWARM'
export type Cls = Truth | 'UNKNOWN'
export type Dec = 'MONITOR' | 'INVESTIGATE' | 'ALERT' | 'SIM_ENGAGE'
export type Status = 'ACTIVE' | 'NEUTRALISED' | 'BREACHED' | 'DEPARTED' | 'FRATRICIDE'
export type Iff = 'VALID' | 'NONE'
export type Path = 'DIRECT' | 'ORBIT' | 'DRIFT'
/** sound-effect events emitted by the simulation; the UI drains the queue and plays them (keeps this module pure) */
export type Sfx = 'contact' | 'classify' | 'decide' | 'neutralised' | 'breach' | 'fratricide' | 'falseAlarm' | 'complete'

export const R = 100
export const BREACH_R = 8
export const MAX_T = 120
export const DIFFS = ['Easy', 'Medium', 'Hard', 'Extreme']
export const CLS_LIST: Cls[] = ['FRIENDLY', 'UNKNOWN', 'HOSTILE_SINGLE', 'HOSTILE_SWARM']
export const DEC_LIST: Dec[] = ['MONITOR', 'INVESTIGATE', 'ALERT', 'SIM_ENGAGE']
/** Training reference answer per ground truth (shown in the AAR). */
export const REF: Record<Truth, Dec> = { FRIENDLY: 'MONITOR', HOSTILE_SINGLE: 'ALERT', HOSTILE_SWARM: 'SIM_ENGAGE' }

export type Params = { name: string; env: string; time: string; sensor: string; type: string; diff: number }
export type Zone = { x: number; y: number; r: number }

export type Track = {
  id: string
  truth: Truth
  ghost: boolean // false contact caused by degraded sensors; not part of the scored ground truth
  appear: number
  life: number // ghosts only
  // kinematics (world units / second)
  x: number; y: number; vx: number; vy: number; su: number
  path: Path
  ang: number; rad: number; rho: number; omega: number // ORBIT parameters
  // observable attributes
  speed: number // km/h shown to the trainee
  altitude: number
  heading: number // compass degrees, 000 = up
  conf: number
  iff: Iff
  // trainee interaction
  ackAt?: number; cls?: Cls; clsAt?: number; dec?: Dec; decAt?: number
  // outcome
  status: Status
  engageAt?: number; leaveAt?: number; endAt?: number; ex: number; ey: number
  // render-only state
  seen: boolean; masked: boolean; dx: number; dy: number; lostUntil: number
  lb: number; nextTrail: number; trail: number[]
}

export type Scenario = Params & { id: string; seed: number; tracks: Track[]; zones: Zone[] }
export type LogEntry = { t: number; kind: 'info' | 'good' | 'warn' | 'bad'; msg: string }
export type Sim = {
  sc: Scenario; tracks: Track[]; zones: Zone[]
  t: number; paused: boolean; done: boolean
  fratricides: number; falseAlarms: number
  log: LogEntry[]; quietSince: number | null; sfx: Sfx[]
  flash: { at: number; text: string; color: string } | null
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ---------- deterministic randomness ----------
export const rng = (s: number) => () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
/** Stateless hash noise in [0,1): same (seed,a,b) always gives the same value, so replays are identical. */
export function noise(seed: number, a: number, b: number) {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 7, 0x85ebca6b)) | 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}
export const randSeed = () => Math.floor(Math.random() * 900000) + 100000
const shuffle = <T,>(a: T[], r: () => number) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

export const headingOf = (vx: number, vy: number) => (Math.atan2(vx, -vy) * 180 / Math.PI + 360) % 360
export const bearingOf = (x: number, y: number) => Math.round(headingOf(x, y)) % 360
const angDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }

// ---------- scenario generation ----------
const SENSOR_PEN: Record<string, number> = { Clear: 0, Moderate: 10, Degraded: 22 }

function blank(): Track {
  return {
    id: '', truth: 'FRIENDLY', ghost: false, appear: 0, life: 0, x: 0, y: 0, vx: 0, vy: 0, su: 0, path: 'DIRECT',
    ang: 0, rad: 0, rho: 0, omega: 0, speed: 0, altitude: 0, heading: 0, conf: 0, iff: 'NONE', status: 'ACTIVE',
    ex: 0, ey: 0, seen: false, masked: false, dx: 0, dy: 0, lostUntil: 0, lb: -1, nextTrail: 0, trail: [],
  }
}

/**
 * Builds a scenario. Ground truth is NEVER encoded in the track id. Truth is only inferable from observable
 * behaviour: IFF squawk (strong but spoofable), route shape (orbit vs. beeline), altitude band, speed, clustering.
 */
export function generate(p: Params, seed = randSeed(), forceN?: number): Scenario {
  const r = rng(seed)
  const pen = SENSOR_PEN[p.sensor] ?? 0
  const night = p.time === 'Night' ? 8 : 0
  const n = forceN ?? (p.type === 'Single' ? 1 + (p.diff > 1 ? 1 : 0) : p.type === 'Multiple' ? 2 + p.diff : 3 + p.diff * 2)

  let truths: Truth[]
  if (p.type === 'Swarm') {
    const f = p.diff > 0 && n > 3 ? 1 : 0
    truths = [...Array(n - f).fill('HOSTILE_SWARM'), ...Array(f).fill('FRIENDLY')]
  } else if (p.type === 'Single') {
    truths = n === 1 ? ['HOSTILE_SINGLE'] : ['HOSTILE_SINGLE', ...Array(n - 1).fill('FRIENDLY')]
  } else {
    const h = Math.max(1, Math.round(n * 0.6))
    truths = [...Array(h).fill('HOSTILE_SINGLE'), ...Array(n - h).fill('FRIENDLY')]
  }
  shuffle(truths, r) // so "the first track is always hostile" is not a pattern

  const mod = n > 800 ? 9000 : 900
  const idOff = Math.floor(r() * mod)
  const mkId = (i: number) => `TRK-${100 + ((idOff + i * 37) % mod)}` // non-sequential, order-independent, unique
  const base = r() * Math.PI * 2
  const spread = Math.min(Math.PI * 2, 0.7 * Math.max(1, Math.sqrt(n / 9))) // arrival arc widens for very large swarms (unchanged for n <= 9)

  const tracks: Track[] = truths.map((truth, i) => {
    const k = blank()
    const a = truth === 'HOSTILE_SWARM' ? base + (r() - 0.5) * spread : r() * Math.PI * 2
    k.id = mkId(i); k.truth = truth
    k.x = Math.cos(a) * 98; k.y = Math.sin(a) * 98
    if (truth === 'FRIENDLY') {
      k.su = 2.2 + r() * 1.0; k.altitude = 140 + Math.floor(r() * 180); k.iff = r() < 0.8 ? 'VALID' : 'NONE'
      k.path = 'ORBIT'; k.ang = a; k.rad = 98; k.rho = 50 + r() * 14; k.omega = r() < 0.5 ? 1 : -1 // omega is the orbit direction
    } else if (truth === 'HOSTILE_SINGLE') {
      k.su = 2.9 + p.diff * 0.7 + r() * 0.9; k.altitude = 40 + Math.floor(r() * 110); k.iff = r() < 0.8 ? 'NONE' : 'VALID' // 20% spoofed
    } else {
      k.su = 2.3 + p.diff * 0.35 + r() * 0.4; k.altitude = 30 + Math.floor(r() * 90); k.iff = 'NONE'
    }
    k.vx = -Math.cos(a) * k.su; k.vy = -Math.sin(a) * k.su // initial heading: inbound (orbiters re-derive velocity every step)
    k.speed = Math.round(k.su * 22); k.heading = headingOf(k.vx, k.vy)
    k.conf = Math.round(Math.max(30, 92 - pen - night - r() * 14))
    k.appear = truth === 'HOSTILE_SWARM' ? 3 + r() * 4 : p.type === 'Swarm' ? 6 + r() * 8 : 2 + i * 6 + r() * 4
    k.dx = k.x; k.dy = k.y
    return k
  })

  const nGhost = p.sensor === 'Degraded' ? 1 + (p.diff > 1 ? 1 : 0) + (p.diff > 2 ? 1 : 0) : p.sensor === 'Moderate' && p.diff > 0 ? 1 : 0
  for (let g = 0; g < nGhost; g++) {
    const k = blank(); const a = r() * Math.PI * 2, rad = 45 + r() * 45, d = r() * Math.PI * 2
    k.id = mkId(n + g); k.ghost = true; k.path = 'DRIFT'
    k.x = Math.cos(a) * rad; k.y = Math.sin(a) * rad; k.su = 0.4 + r() * 0.6
    k.vx = Math.cos(d) * k.su; k.vy = Math.sin(d) * k.su
    k.speed = Math.round(20 + r() * 70); k.altitude = 20 + Math.floor(r() * 280); k.heading = headingOf(k.vx, k.vy)
    k.conf = Math.round(28 + r() * 14); k.appear = 5 + r() * 35; k.life = 5 + r() * 4; k.dx = k.x; k.dy = k.y
    tracks.push(k)
  }

  const nz = p.env === 'Urban' ? 3 : p.env === 'Mixed' ? 2 : 0
  const zones: Zone[] = Array.from({ length: nz }, () => { const a = r() * Math.PI * 2, d = 28 + r() * 40; return { x: Math.cos(a) * d, y: Math.sin(a) * d, r: 9 + r() * 7 } })

  return { ...p, seed, id: `AX-${seed.toString(16).slice(0, 4).toUpperCase()}-${DIFFS[p.diff][0]}`, tracks, zones }
}

// ---------- runtime ----------
export function newSim(sc: Scenario): Sim {
  return {
    sc, zones: sc.zones, tracks: sc.tracks.map(k => ({ ...k, trail: [] })),
    t: 0, paused: false, done: false, fratricides: 0, falseAlarms: 0, log: [], quietSince: null, sfx: [], flash: null,
  }
}
const logEv = (sim: Sim, kind: LogEntry['kind'], msg: string) => { sim.log.push({ t: sim.t, kind, msg }); if (sim.log.length > 60) sim.log.shift() }
const emit = (sim: Sim, s: Sfx) => { if (sim.sfx.length < 40) sim.sfx.push(s) }
export const isVisible = (sim: Sim, k: Track) => k.status === 'ACTIVE' && sim.t >= k.appear && sim.t >= k.lostUntil
export const isLive = (sim: Sim, k: Track) => k.status === 'ACTIVE' && sim.t >= k.appear
export const find = (sim: Sim, id: string) => sim.tracks.find(k => k.id === id)

const CELL = 14 // = flocking neighbour radius, so a 3x3 cell lookup finds every neighbour: O(n) instead of O(n^2)
const cellKey = (cx: number, cy: number) => (cx + 40) * 128 + (cy + 40)
type Grid = Map<number, Track[]>
function buildGrid(swarm: Track[]): Grid {
  const g: Grid = new Map()
  for (const o of swarm) { const key = cellKey(Math.floor(o.x / CELL), Math.floor(o.y / CELL)); const a = g.get(key); if (a) a.push(o); else g.set(key, [o]) }
  return g
}
function boids(k: Track, grid: Grid, dt: number) {
  let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, c = 0
  const gx = Math.floor(k.x / CELL), gy = Math.floor(k.y / CELL)
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const cell = grid.get(cellKey(gx + i, gy + j))
    if (!cell) continue
    for (const o of cell) {
      if (o === k) continue
      const dx = k.x - o.x, dy = k.y - o.y, d = Math.hypot(dx, dy)
      if (d > 0 && d < CELL) { sx += (dx / d) * (CELL - d); sy += (dy / d) * (CELL - d); ax += o.vx; ay += o.vy; cx += o.x; cy += o.y; c++ }
    }
  }
  const dist = Math.hypot(k.x, k.y) || 1
  let fx = (-k.x / dist) * 0.6, fy = (-k.y / dist) * 0.6 // gentle homing so the swarm stays on its attack axis
  if (c) { fx += sx * 0.15 + (ax / c) * 0.05 + (cx / c - k.x) * 0.05; fy += sy * 0.15 + (ay / c) * 0.05 + (cy / c - k.y) * 0.05 }
  k.vx += fx * dt; k.vy += fy * dt
  const sp = Math.hypot(k.vx, k.vy)
  if (sp > 0) { k.vx = (k.vx / sp) * k.su; k.vy = (k.vy / sp) * k.su }
}

export function step(sim: Sim, dt: number) {
  if (dt <= 0) return
  const t = (sim.t += dt)
  const seed = sim.sc.seed
  const jit = ({ Clear: 0, Moderate: 0.9, Degraded: 2.2 } as Record<string, number>)[sim.sc.sensor] ?? 0
  const dropP = ({ Clear: 0, Moderate: 0.01, Degraded: 0.05 } as Record<string, number>)[sim.sc.sensor] ?? 0
  const bucket = Math.floor(t * 4)
  const grid = buildGrid(sim.tracks.filter(k => k.truth === 'HOSTILE_SWARM' && !k.ghost && k.status === 'ACTIVE' && t >= k.appear))

  for (let idx = 0; idx < sim.tracks.length; idx++) {
    const k = sim.tracks[idx]
    if (k.status !== 'ACTIVE' || t < k.appear) continue
    if (!k.seen) { k.seen = true; logEv(sim, 'info', `NEW CONTACT ${k.id} · BRG ${String(bearingOf(k.x, k.y)).padStart(3, '0')}°`); emit(sim, 'contact') }
    if (k.ghost && t > k.appear + k.life) { k.status = 'DEPARTED'; k.endAt = t; k.ex = k.x; k.ey = k.y; logEv(sim, 'info', `${k.id} CONTACT LOST`); continue }
    if (k.engageAt !== undefined && t >= k.engageAt) { k.status = 'NEUTRALISED'; k.endAt = t; k.ex = k.x; k.ey = k.y; logEv(sim, 'good', `${k.id} NEUTRALISED`); emit(sim, 'neutralised'); continue }
    if (k.leaveAt !== undefined && t >= k.leaveAt) { k.status = 'DEPARTED'; k.endAt = t; k.ex = k.x; k.ey = k.y; logEv(sim, 'info', `${k.id} CLEARED SECTOR`); continue }

    const px = k.x, py = k.y
    if (k.path === 'ORBIT') {
      // constant-speed spiral in, then orbit: radial speed is capped so the displayed speed matches what the blip really does
      k.rad += clamp(k.rho - k.rad, -0.5 * k.su * dt, 0.5 * k.su * dt)
      k.ang += k.omega * (k.su / Math.max(k.rad, 10)) * dt
      k.x = Math.cos(k.ang) * k.rad; k.y = Math.sin(k.ang) * k.rad
      k.vx = (k.x - px) / dt; k.vy = (k.y - py) / dt
    } else {
      if (k.path === 'DIRECT' && k.truth === 'HOSTILE_SWARM') boids(k, grid, dt)
      k.x += k.vx * dt; k.y += k.vy * dt
    }
    k.heading = headingOf(k.vx, k.vy)

    if (!k.ghost && k.truth !== 'FRIENDLY' && Math.hypot(k.x, k.y) < BREACH_R) {
      k.status = 'BREACHED'; k.endAt = t; k.ex = k.x; k.ey = k.y
      sim.flash = { at: t, text: 'PERIMETER BREACH', color: '#f87171' }
      logEv(sim, 'bad', `${k.id} BREACHED PERIMETER`); emit(sim, 'breach')
      continue
    }

    // sensor model: position shimmer, urban masking, dropouts. All deterministic per (seed, track, time bucket).
    k.masked = sim.zones.some(z => Math.hypot(k.x - z.x, k.y - z.y) < z.r)
    const j = jit + (k.masked ? 1.2 : 0)
    k.dx = k.x + (noise(seed, idx, bucket * 2) - 0.5) * 2 * j
    k.dy = k.y + (noise(seed, idx, bucket * 2 + 1) - 0.5) * 2 * j
    if (bucket !== k.lb) {
      k.lb = bucket
      const p = dropP + (k.masked ? 0.04 : 0)
      if (p > 0 && t >= k.lostUntil && noise(seed, idx + 5000, bucket) < p) k.lostUntil = t + 0.7 + noise(seed, idx + 9000, bucket) * 0.8
    }
    if (t >= k.nextTrail) { k.trail.push(k.dx, k.dy); if (k.trail.length > 20) k.trail.splice(0, 2); k.nextTrail = t + 0.5 }
  }
}

/** Confidence as displayed: degraded by urban masking, with a slow (1 Hz) deterministic wobble instead of per-frame randomness. */
export function confOf(sim: Sim, k: Track) {
  const w = Math.round((noise(sim.sc.seed, sim.tracks.indexOf(k) + 777, Math.floor(sim.t)) - 0.5) * 6)
  return clamp(k.conf - (k.masked ? 18 : 0) + w, 15, 99)
}

export function isFinished(sim: Sim): boolean {
  if (sim.t > MAX_T) return true
  const real = sim.tracks.filter(k => !k.ghost)
  if (!real.some(k => k.status === 'ACTIVE')) return true
  if (real.some(k => k.truth !== 'FRIENDLY' && k.status === 'ACTIVE')) { sim.quietSince = null; return false }
  sim.quietSince ??= sim.t // only friendlies left: give the trainee 8 s to finish handling them
  return sim.t - sim.quietSince > 8
}

// ---------- trainee actions ----------
export function ack(sim: Sim, ids: string[]) {
  for (const id of ids) { const k = find(sim, id); if (k && k.ackAt === undefined && isVisible(sim, k)) k.ackAt = sim.t }
}
export function classify(sim: Sim, ids: string[], c: Cls) {
  let n = 0
  for (const id of ids) {
    const k = find(sim, id)
    if (!k || !isVisible(sim, k) || k.cls !== undefined) continue // first classification is committed; repeated clicks are no-ops
    k.cls = c; k.clsAt = sim.t; if (k.ackAt === undefined) k.ackAt = sim.t; n++
  }
  if (n) emit(sim, 'classify')
}
export function decide(sim: Sim, ids: string[], d: Dec) {
  let n = 0
  const errs0 = sim.fratricides + sim.falseAlarms
  for (const id of ids) {
    const k = find(sim, id)
    if (!k || !isVisible(sim, k) || k.cls === undefined) continue
    k.dec = d; k.decAt = sim.t; n++
    if (k.ghost) {
      if (d === 'ALERT' || d === 'SIM_ENGAGE') { sim.falseAlarms++; logEv(sim, 'warn', `FALSE ALARM · ${k.id} was sensor clutter`); emit(sim, 'falseAlarm') }
      continue
    }
    if (k.truth === 'FRIENDLY') {
      if (d === 'SIM_ENGAGE') {
        k.status = 'FRATRICIDE'; k.endAt = sim.t; k.ex = k.x; k.ey = k.y; sim.fratricides++
        sim.flash = { at: sim.t, text: 'BLUE-ON-BLUE', color: '#f87171' }; logEv(sim, 'bad', `${k.id} WAS FRIENDLY · BLUE-ON-BLUE`); emit(sim, 'fratricide')
      } else if (d === 'MONITOR' || d === 'INVESTIGATE') k.leaveAt ??= sim.t + 4
    } else if (d === 'SIM_ENGAGE') k.engageAt = Math.min(k.engageAt ?? Infinity, sim.t + 1.5)
    else if (d === 'ALERT' && k.truth === 'HOSTILE_SINGLE') k.engageAt = Math.min(k.engageAt ?? Infinity, sim.t + 4)
    // MONITOR / INVESTIGATE on a hostile, or ALERT on a swarm member, do not stop it: it keeps coming and can be re-tasked.
  }
  if (n && sim.fratricides + sim.falseAlarms === errs0) emit(sim, 'decide') // no cheerful chime on top of an error buzzer
}

/**
 * The co-moving group containing `id` (one swarm handled as one object, as a real operator would).
 * Transitive: members chain together through neighbours within 22 units whose headings differ by < 50 degrees,
 * so edge members of a swarm are included. Ghosts and dropped-out tracks never join a cluster.
 */
export function clusterOf(sim: Sim, id: string): string[] {
  const root = find(sim, id)
  if (!root) return []
  if (root.ghost) return [id]
  const cand = sim.tracks.filter(o => !o.ghost && o !== root && isVisible(sim, o))
  const out = [root], taken = new Set<Track>([root])
  for (let i = 0; i < out.length; i++) {
    const k = out[i]
    for (const o of cand) {
      if (taken.has(o)) continue
      if (Math.hypot(o.x - k.x, o.y - k.y) < 22 && angDiff(o.heading, k.heading) < 50) { taken.add(o); out.push(o) }
    }
  }
  return out.map(k => k.id)
}

// ---------- scoring ----------
export type Result = { det: number; cls: number; dec: number; avg: number; rs: number; sa: number; overall: number; fratricides: number; falseAlarms: number; breaches: number; ok: boolean }
export const clsCredit = (k: Track) => (k.cls === k.truth ? 1 : k.cls === 'UNKNOWN' ? 0.3 : 0)
export function decCredit(k: Track): number {
  const d = k.dec
  if (k.truth === 'FRIENDLY') {
    if (d === undefined) return k.cls === 'FRIENDLY' ? 1 : 0 // passively monitoring a friendly is correct
    return d === 'MONITOR' ? 1 : d === 'INVESTIGATE' ? 0.7 : d === 'ALERT' ? 0.2 : 0
  }
  if (d === undefined) return 0
  if (k.truth === 'HOSTILE_SINGLE') return d === 'ALERT' ? 1 : d === 'SIM_ENGAGE' ? 0.6 : d === 'INVESTIGATE' ? 0.4 : 0
  return d === 'SIM_ENGAGE' ? 1 : d === 'ALERT' ? 0.4 : d === 'INVESTIGATE' ? 0.3 : 0
}
export function score(sim: Sim): Result {
  const real = sim.tracks.filter(k => !k.ghost)
  const n = real.length || 1
  const hostile = real.filter(k => k.truth !== 'FRIENDLY')
  const det = (real.filter(k => k.ackAt !== undefined).length / n) * 100
  const cls = (real.reduce((s, k) => s + clsCredit(k), 0) / n) * 100
  const dec = (real.reduce((s, k) => s + decCredit(k), 0) / n) * 100
  const rt = real.filter(k => k.clsAt !== undefined).map(k => k.clsAt! - k.appear)
  const avg = rt.length ? rt.reduce((a, b) => a + b, 0) / rt.length : 20
  const rs = clamp(100 - Math.max(0, avg - 2) * 6, 0, 100)
  const breaches = hostile.filter(k => k.status === 'BREACHED').length
  const sa = det * 0.5 + (hostile.length ? 1 - breaches / hostile.length : 1) * 50
  let overall = det * 0.2 + cls * 0.3 + dec * 0.3 + rs * 0.1 + sa * 0.1
  overall -= sim.fratricides * 25 + sim.falseAlarms * 8 + breaches * 10
  overall = clamp(Math.round(overall), 0, 100)
  if (sim.fratricides > 0) overall = Math.min(overall, 49)
  return {
    det: Math.round(det), cls: Math.round(cls), dec: Math.round(dec), avg: +avg.toFixed(1), rs: Math.round(rs), sa: Math.round(sa),
    overall, fratricides: sim.fratricides, falseAlarms: sim.falseAlarms, breaches, ok: overall >= 60 && sim.fratricides === 0,
  }
}

// ---------- rule-based adaptive difficulty (tiers 0..3 = Level 1..4) ----------
export function adapt(sc: Params, r: Result): { next: Scenario; focus: string; nextDiff: number } {
  const w: [string, number][] = [['Classification under degraded sensors', r.cls], ['Response decision-making', r.dec], ['Rapid reaction', r.rs], ['Threat detection', r.det]]
  w.sort((a, b) => a[1] - b[1])
  let focus = w[0][1] >= 90 ? 'Swarm complexity (all skills strong)' : w[0][0]
  if (r.fratricides > 0) focus = 'Friendly identification (avoid blue-on-blue)'
  const nextDiff = clamp(sc.diff + (r.overall >= 85 ? 1 : r.overall < 55 ? -1 : 0), 0, 3)
  let p: Params = { name: 'Adaptive Session', env: sc.env, time: sc.time, sensor: sc.sensor, type: sc.type, diff: nextDiff }
  if (r.fratricides > 0) p = { ...p, type: 'Multiple', sensor: 'Moderate' }
  else if (focus.startsWith('Classification')) p = { ...p, sensor: 'Degraded', type: 'Multiple' }
  else if (focus.startsWith('Response') || focus.startsWith('Threat')) p = { ...p, type: 'Multiple' }
  else if (focus.startsWith('Rapid')) p = { ...p, diff: Math.min(3, nextDiff + 1) }
  else p = { ...p, type: 'Swarm' }
  return { next: generate(p), focus, nextDiff }
}

// ---------- history storage (client-side only; never throws) ----------
export type Rec = Result & { ts: number; scenario: string; diff: number; seed: number; nextDiff: number; demo?: boolean }
const KEY = 'aegis_hist_v2'
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : null)
/** Accepts only well-formed history records, repairs harmless gaps, and returns null for anything else. Never throws. */
export function sanitizeRec(r: unknown): Rec | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  const ts = num(o.ts, 0, 8.64e15), overall = num(o.overall, 0, 100), avg = num(o.avg, 0, 1000)
  if (ts === null || overall === null || avg === null) return null
  const f = (v: unknown, hi = 100) => num(v, 0, hi) ?? 0
  return {
    det: f(o.det), cls: f(o.cls), dec: f(o.dec), avg, rs: f(o.rs), sa: f(o.sa), overall,
    fratricides: Math.round(f(o.fratricides, 99)), falseAlarms: Math.round(f(o.falseAlarms, 99)), breaches: Math.round(f(o.breaches, 99)),
    ok: o.ok === true, ts, scenario: typeof o.scenario === 'string' && o.scenario ? o.scenario.slice(0, 40) : 'Unknown scenario',
    diff: Math.round(f(o.diff, 3)), seed: Math.round(f(o.seed, 1e9)), nextDiff: Math.round(f(o.nextDiff, 3)), ...(o.demo === true ? { demo: true } : {}),
  }
}
export function loadHist(): Rec[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const a = JSON.parse(raw)
    return Array.isArray(a) ? a.map(sanitizeRec).filter((r): r is Rec => r !== null).slice(-30) : []
  } catch { return [] }
}
export function saveHist(h: Rec[]) { try { localStorage.setItem(KEY, JSON.stringify(h.slice(-30))) } catch { /* storage blocked or full: keep running in memory */ } }
export function demoHist(): Rec[] {
  const now = Date.now(), mk = (i: number, overall: number, avg: number, name: string, diff: number): Rec => ({
    det: 88 + i, cls: overall - 6, dec: overall - 3, avg, rs: 100 - Math.round(avg * 6), sa: 80 + i * 2, overall, fratricides: 0, falseAlarms: 0, breaches: 0, ok: overall >= 60,
    ts: now - (6 - i) * 3600e3, scenario: name, diff, seed: 100000 + i, nextDiff: Math.min(3, diff + (overall >= 85 ? 1 : 0)), demo: true,
  })
  return [mk(1, 58, 8.1, 'Urban Perimeter', 0), mk(2, 66, 6.9, 'Urban Perimeter', 0), mk(3, 74, 5.8, 'Night Intrusion', 1), mk(4, 81, 4.9, 'Night Intrusion', 1), mk(5, 88, 4.1, 'Swarm Breach', 2)]
}
