import { useEffect, useRef, useState } from 'react'
import { Pause, Play as PlayIcon } from 'lucide-react'
import RadarCanvas from './RadarCanvas'
import { Btn, C, mmss } from './ui'
import { play, toggleMuted } from './audio'
import {
  CLS_LIST, DEC_LIST, ack, classify, clusterOf, confOf, decide, find, isFinished, isLive, isVisible, newSim, step,
  type Cls, type Dec, type Scenario, type Sim, type Track,
} from './sim'

type Props = { sc: Scenario; blind: boolean; onDone: (sim: Sim) => void }
const SENSOR_REL: Record<string, number> = { Clear: 94, Moderate: 78, Degraded: 62 }
const LOCK_AFTER_CLASSIFY = 450 // ms: stops a double-click on a class button from also hitting the same-position response button
const LOCK_AFTER_DECIDE = 300

export default function Simulation({ sc, blind, onDone }: Props) {
  const simRef = useRef<Sim>(null as unknown as Sim)
  if (!simRef.current) simRef.current = newSim(sc)
  const [selected, setSelected] = useState<string[]>([])
  const [, setUi] = useState(0)
  const kick = () => setUi(u => u + 1)
  const selRef = useRef<string[]>([]); selRef.current = selected
  const lock = useRef(0)
  const doneRef = useRef(onDone); doneRef.current = onDone
  const timer = useRef<number>(0)
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
  const showFps = params.has('debug') || params.has('stress')

  const finish = () => {
    const s = simRef.current
    if (s.done) return
    s.done = true
    play('complete')
    timer.current = window.setTimeout(() => doneRef.current(s), 900)
    kick()
  }

  // ---- fixed game loop; React re-renders the side panel at ~10 Hz, the radar draws itself on its own canvas loop ----
  useEffect(() => {
    let raf = 0, last = performance.now(), lastUi = 0
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const sim = simRef.current
      const dt = Math.min(0.1, (now - last) / 1000); last = now
      if (!sim.paused && !sim.done) { step(sim, dt); if (isFinished(sim)) finish() }
      if (sim.sfx.length) for (const e of sim.sfx.splice(0)) play(e) // drained every frame even when muted so the queue cannot grow
      if (now - lastUi > 100) {
        lastUi = now
        setSelected(s => { const f = s.filter(id => { const k = find(sim, id); return !!k && isLive(sim, k) }); return f.length === s.length ? s : f })
        kick()
      }
    }
    raf = requestAnimationFrame(frame)
    const autoPause = () => { const s = simRef.current; if (!s.done) { s.paused = true; kick() } } // tab hidden / window blurred: freeze the clock, never penalise
    const onVis = () => { if (document.hidden) autoPause() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('blur', autoPause)
    if (params.has('debug')) (window as unknown as { __aegis: unknown }).__aegis = { simRef }
    return () => {
      cancelAnimationFrame(raf); clearTimeout(timer.current) // no onDone after unmount (e.g. operator aborted mid-run)
      document.removeEventListener('visibilitychange', onVis); window.removeEventListener('blur', autoPause)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sim = simRef.current
  const selTracks = selected.map(id => find(sim, id)).filter((k): k is Track => !!k && isLive(sim, k))
  const primary = selTracks[0]
  const needCls = selTracks.some(k => k.cls === undefined)
  const lost = selTracks.some(k => sim.t < k.lostUntil)
  const locked = Date.now() < lock.current
  const blocked = locked || lost || sim.paused || sim.done
  const visibleTracks = sim.tracks.filter(k => isVisible(sim, k))
  const nearest = visibleTracks.filter(k => k.cls !== 'FRIENDLY').reduce((m, k) => Math.min(m, Math.hypot(k.x, k.y)), 99)
  const lvl: [string, string] = nearest > 60 ? ['LOW', C.good] : nearest > 40 ? ['ELEVATED', 'text-cyan-300'] : nearest > 22 ? ['HIGH', C.warn] : ['CRITICAL', C.bad]

  // ---- actions (guarded in the handler, not only by `disabled`, so spam-clicks and key repeats cannot slip through) ----
  const doClassify = (c: Cls) => {
    const s = simRef.current, ids = selRef.current
    if (s.paused || s.done || Date.now() < lock.current) return
    if (!ids.some(id => { const k = find(s, id); return k && isVisible(s, k) && k.cls === undefined })) return
    classify(s, ids, c); lock.current = Date.now() + LOCK_AFTER_CLASSIFY; kick()
  }
  const doDecide = (d: Dec) => {
    const s = simRef.current, ids = selRef.current
    if (s.paused || s.done || Date.now() < lock.current) return
    const ks = ids.map(id => find(s, id)).filter((k): k is Track => !!k && isVisible(s, k))
    if (!ks.length || ks.some(k => k.cls === undefined)) return
    decide(s, ids, d); lock.current = Date.now() + LOCK_AFTER_DECIDE; kick()
  }
  const pick = (id: string | null, additive: boolean) => {
    const s = simRef.current
    if (s.paused || s.done) return
    if (!id) { if (!additive) setSelected([]); return }
    if (additive) setSelected(cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]))
    else { const cl = clusterOf(s, id); setSelected(cl); ack(s, cl) }
    ack(s, [id])
  }
  const togglePause = () => { const s = simRef.current; if (s.done) return; s.paused = !s.paused; kick() }
  const cycle = () => {
    const s = simRef.current
    const list = s.tracks.filter(k => isVisible(s, k)).sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))
    if (!list.length) return
    const i = list.findIndex(k => k.id === selRef.current[0])
    pick(list[(i + 1) % list.length].id, false)
  }
  const act = useRef({ doClassify, doDecide, togglePause, cycle })
  act.current = { doClassify, doDecide, togglePause, cycle }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return
      const a = act.current
      if (e.key === ' ') { e.preventDefault(); a.togglePause() }
      else if (e.key === 'Escape') setSelected([])
      else if (e.key === 'm' || e.key === 'M') toggleMuted()
      else if (e.key === 'Tab') { e.preventDefault(); a.cycle() }
      else if (/^[1-4]$/.test(e.key)) {
        const s = simRef.current, i = +e.key - 1
        const need = selRef.current.some(id => { const k = find(s, id); return k && k.cls === undefined })
        if (need) a.doClassify(CLS_LIST[i]); else if (selRef.current.length) a.doDecide(DEC_LIST[i])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const endMission = () => { if (window.confirm('End the mission now? Unresolved tracks are scored as missed.')) finish() }
  const pending = primary?.engageAt !== undefined ? Math.max(0, Math.ceil(primary.engageAt - sim.t)) : null

  return (
    <div className="flex-1 min-h-0 grid lg:grid-cols-3 gap-4 p-4 overflow-y-auto lg:overflow-hidden">
      <div className="panel p-3 lg:col-span-2 flex flex-col min-h-0">
        <div className="flex justify-between items-center text-xs mono mb-2 gap-2">
          <span className="truncate">TRAINING SECTOR A-17 · {sc.id}</span>
          <span className="tabular-nums">T+{mmss(sim.t)}</span>
          <span className={lvl[1]}>THREAT: {lvl[0]}</span>
          <button type="button" onClick={togglePause} aria-label={sim.paused ? 'Resume' : 'Pause'} className="border border-slate-600 rounded px-2 py-0.5 hover:border-cyan-500">
            {sim.paused ? <PlayIcon className="w-3 h-3 inline" /> : <Pause className="w-3 h-3 inline" />}
          </button>
        </div>
        <div className="relative flex-1 min-h-0 aspect-square lg:aspect-auto rounded border border-[#1c3a3a] overflow-hidden shadow-[inset_0_0_50px_rgba(0,0,0,0.5)]">
          <RadarCanvas simRef={simRef} selected={selected} night={sc.time === 'Night'} blind={blind} showFps={showFps} onPick={pick} />
          {(sim.paused || sim.done) && (
            <button type="button" onClick={togglePause} className="absolute inset-0 z-10 bg-black/70 flex flex-col items-center justify-center mono text-cyan-300 tracking-widest">
              {sim.done ? <span>MISSION COMPLETE · COMPILING AFTER-ACTION REVIEW…</span> : <><span className="text-2xl">PAUSED</span><span className="text-xs text-slate-400 mt-2">Click or press Space to resume. The clock is frozen; nothing is penalised.</span></>}
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4 lg:overflow-y-auto pr-1 min-h-0">
        <div className="panel p-4">
          <div className={`text-xs mb-2 ${C.terminal}`}>THREAT INTELLIGENCE</div>
          {!primary ? (
            <p className="text-sm text-slate-400">Select a track on the radar. Active contacts: {visibleTracks.length}. <span className="text-slate-500">Click selects a co-moving cluster · Shift-click adds or removes · Tab cycles · 1–4 act · Space pauses · M mutes.</span></p>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="mono text-lg font-bold flex items-center gap-2">{primary.id}{selTracks.length > 1 && <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/50 text-cyan-200">CLUSTER ×{selTracks.length}</span>}</div>
              <div className="grid grid-cols-2 gap-1 mono text-xs tabular-nums bg-black/30 p-2 rounded border border-slate-800">
                <span>CLASS: {primary.cls ?? 'UNCLASSIFIED'}</span><span>SPEED: {blind ? '—' : primary.speed + ' km/h'}</span>
                <span>ALT: {primary.altitude}m</span><span>HDG: {String(Math.round(primary.heading) % 360).padStart(3, '0')}°</span>
                <span>CONF: {blind ? '??' : confOf(sim, primary) + '%'}</span><span>IFF: {blind ? 'HIDDEN' : primary.iff === 'VALID' ? 'SQUAWK VALID' : 'NO SQUAWK'}</span>
                <span>RANGE: {Math.round(Math.hypot(primary.x, primary.y))} u</span><span>DETECTED: {mmss(primary.appear)}</span>
              </div>
              {(lost || primary.masked) && <div className={`text-xs mono ${lost ? C.bad : C.warn}`}>{lost ? 'SIGNAL LOST: STAND BY' : 'URBAN MASKING: DATA UNRELIABLE'}</div>}
              {needCls ? (
                <>
                  <div className="text-xs text-slate-400 pt-2">CLASSIFY {selTracks.length > 1 ? `(applies to ${selTracks.length} tracks)` : ''}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {CLS_LIST.map((c, i) => <Btn key={c} sub disabled={blocked} testid={`cls-${c}`} onClick={() => doClassify(c)}>{`${i + 1} · ${c.replace('_', ' — ')}`}</Btn>)}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs text-slate-400 pt-2">RESPONSE DECISION (simulated) {primary.dec ? `· LAST: ${primary.dec.replace('_', ' ')}` : ''}</div>
                  <div className="grid grid-cols-2 gap-2">
                    {DEC_LIST.map((d, i) => <Btn key={d} sub disabled={blocked} testid={`dec-${d}`} onClick={() => doDecide(d)}>{`${i + 1} · ${d.replace('_', ' ')}`}</Btn>)}
                  </div>
                  {pending !== null && <div className={`text-xs mono ${C.warn}`}>RESPONSE EN ROUTE · {pending}s</div>}
                </>
              )}
            </div>
          )}
        </div>

        <div className="panel p-4 text-xs mono bg-black/20">
          <div className={`mb-1 ${C.terminal}`}>EVENT LOG</div>
          <div className="space-y-0.5 min-h-[7rem]" aria-live="polite">
            {sim.log.slice(-6).map((e, i) => <div key={i} className={e.kind === 'bad' ? C.bad : e.kind === 'good' ? C.good : e.kind === 'warn' ? C.warn : 'text-slate-400'}>T+{mmss(e.t)} {e.msg}</div>)}
            {!sim.log.length && <div className="text-slate-500">Awaiting contacts…</div>}
          </div>
        </div>

        <div className="panel p-4 text-xs mono space-y-1 bg-black/20">
          <div className={C.terminal}>SCENARIO ENGINE · SEEDED PROCEDURAL</div>
          <div className="tabular-nums">SEED {sc.seed} · SENSOR RELIABILITY {SENSOR_REL[sc.sensor] ?? 90}%{blind ? ' · BLIND MODE' : ''}</div>
          <p className="font-sans text-slate-400 pt-1 text-[10px] leading-tight">Arrival times, routes, speeds, altitudes, IFF behaviour, clutter and dropouts are generated from the seed. Replaying a seed reproduces the exact scenario.</p>
          <div className="pt-2"><Btn sub onClick={endMission} disabled={sim.done}>END MISSION</Btn></div>
        </div>
      </div>
    </div>
  )
}
