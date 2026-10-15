import { useEffect, useMemo, useState } from 'react'
import { Play, FlaskConical, ClipboardList, Shuffle, ShieldCheck, Brain, RefreshCw, RotateCcw, Download } from 'lucide-react'
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, type ChartData, type ChartOptions } from 'chart.js'
import { Line } from 'react-chartjs-2'
import Simulation from './Simulation'
import { Btn, C, Ring, SoundToggle } from './ui'
import { unlock } from './audio'
import { download, historyCsv, sessionCsv, stamp } from './csv'
import {
  DIFFS, REF, adapt, clsCredit, demoHist, generate, loadHist, randSeed, saveHist, score,
  type Params, type Rec, type Result, type Scenario, type Sim, type Track,
} from './sim'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend)
ChartJS.defaults.color = '#9fb3c0' // the default (#666) is unreadable on the dark panels
ChartJS.defaults.borderColor = 'rgba(255,255,255,0.07)'

const PRESETS: Params[] = [
  { name: 'Urban Perimeter', env: 'Urban', time: 'Day', sensor: 'Clear', type: 'Single', diff: 0 },
  { name: 'Night Intrusion', env: 'Rural', time: 'Night', sensor: 'Moderate', type: 'Multiple', diff: 1 },
  { name: 'Swarm Breach', env: 'Mixed', time: 'Day', sensor: 'Degraded', type: 'Swarm', diff: 2 },
  { name: 'Chaos Vector', env: 'Urban', time: 'Night', sensor: 'Degraded', type: 'Swarm', diff: 3 },
]
type Screen = 'home' | 'select' | 'brief' | 'sim' | 'aar'
type Outcome = { tracks: Track[]; r: Result; sc: Scenario }
// ?stress=N forces N tracks (performance demo). Capped so a typo cannot freeze the tab.
const stress = () => { const v = Number(new URLSearchParams(location.search).get('stress')); return v > 0 ? Math.min(v, 1500) : undefined }
const mk = (p: Params, seed?: number) => generate(p, seed ?? randSeed(), stress())
const rand = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

export default function App() {
  const [scr, setScr] = useState<Screen>('home')
  const [sc, setSc] = useState<Scenario>(() => mk(PRESETS[0]))
  const [blind, setBlind] = useState(false)
  const [res, setRes] = useState<Outcome | null>(null)
  const [hist, setHist] = useState<Rec[]>(loadHist)
  const [custom, setCustom] = useState<Params>({ name: 'Custom Scenario', env: 'Urban', time: 'Day', sensor: 'Clear', type: 'Single', diff: 1 })
  useEffect(() => saveHist(hist), [hist])
  const [note, setNote] = useState('')
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(''), 4000); return () => clearTimeout(t) }, [note])
  const loadDemo = () => { setHist(h => [...demoHist(), ...h.filter(x => !x.demo)]); setNote('Loaded 5 demo sessions (labelled DEMO)') }
  const exportHistory = () => setNote(download(`aegis-x-history-${stamp()}.csv`, historyCsv(hist)) ? `Exported ${hist.length} session${hist.length === 1 ? '' : 's'} to CSV` : 'Export was blocked by the browser')
  const exportSession = () => { if (res) setNote(download(`aegis-x-session-${res.sc.id}-${stamp()}.csv`, sessionCsv(res.sc, res.tracks)) ? 'Exported session replay to CSV' : 'Export was blocked by the browser') }

  const lastReal = [...hist].reverse().find(h => !h.demo) // demo data must never change the operator's level
  const level = (lastReal ? lastReal.nextDiff : 0) + 1 // Level 1..4 = difficulty tier recommended for the next session
  const aar = useMemo(() => (res ? adapt(res.sc, res.r) : null), [res])
  const go = (s: Scenario) => { setSc(s); setScr('brief') }
  const avg = (k: keyof Result) => (hist.length ? Math.round(hist.reduce((a, h) => a + (h[k] as number), 0) / hist.length) + '%' : '—')
  const avgRt = hist.length ? (hist.reduce((a, h) => a + h.avg, 0) / hist.length).toFixed(1) + 's' : '—'
  const demoCount = hist.filter(h => h.demo).length

  const home = () => {
    if (scr === 'sim' && !window.confirm('Abort the running simulation? Progress will be lost.')) return
    setScr('home')
  }
  const onDone = (sim: Sim) => {
    const r = score(sim)
    const a = adapt(sc, r)
    setHist(h => [...h, { ...r, ts: Date.now(), scenario: sc.name, diff: sc.diff, seed: sc.seed, nextDiff: a.nextDiff }])
    setRes({ tracks: sim.tracks, r, sc })
    setScr('aar')
  }
  const sel = (k: 'env' | 'time' | 'sensor' | 'type', opts: string[]) => (
    <select value={custom[k]} aria-label={k} onChange={e => setCustom({ ...custom, [k]: e.target.value })} className="bg-[#0D141C] border border-slate-600 rounded px-2 py-1 text-sm">{opts.map(o => <option key={o}>{o}</option>)}</select>
  )

  const chartData: ChartData<'line'> = {
    labels: hist.map((h, i) => `#${i + 1} ${h.scenario}${h.demo ? ' (demo)' : ''}`),
    datasets: [
      { label: 'Overall Score', data: hist.map(h => h.overall), borderColor: '#34d399', backgroundColor: 'rgba(52,211,153,0.2)', yAxisID: 'y', tension: 0.25 },
      { label: 'Avg Reaction (s)', data: hist.map(h => h.avg), borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.2)', yAxisID: 'y1', tension: 0.25 },
    ],
  }
  const chartOpts: ChartOptions<'line'> = {
    responsive: true, maintainAspectRatio: false,
    scales: { y: { type: 'linear', position: 'left', min: 0, max: 100 }, y1: { type: 'linear', position: 'right', min: 0, grid: { drawOnChartArea: false } } },
  }
  const rows = res ? res.tracks.filter(t => t.seen) : []

  return (
    <div onPointerDownCapture={unlock} onKeyDownCapture={unlock} className="relative h-dvh w-screen overflow-hidden crt flex flex-col bg-[#070B10] text-[#cfe3ea]">
      <header className="flex items-center justify-between px-5 py-3 border-b border-[#1c2c3a] bg-[#0D141C]/90 z-10 shrink-0">
        <button type="button" onClick={home} className="flex items-center gap-2"><ShieldCheck className="text-cyan-400" /><b className="tracking-widest">AEGIS-X</b><span className="text-xs text-slate-400 hidden md:inline">Simulation Command Centre</span></button>
        <div className="flex items-center gap-3 text-xs mono text-slate-400"><span>OPERATOR ALPHA · LEVEL {level} · <span className={C.good}>● SYSTEMS ONLINE</span></span><SoundToggle /></div>
      </header>

      {scr === 'home' && <main className="flex-1 overflow-y-auto p-6 space-y-6 max-w-6xl mx-auto w-full">
        <section className="panel p-8 text-center"><h1 className="text-3xl md:text-4xl font-bold tracking-widest">TRAIN. DETECT. DECIDE. RESPOND.</h1>
          <p className="text-slate-400 mt-2">Simulation for drone threat recognition, classification and response decision training.</p>
          <div className={`mt-4 mono text-xs ${C.terminal}`}>SCENARIO → DETECT → CLASSIFY → DECIDE → SCORE → ANALYZE → ADAPT → RETRAIN</div></section>
        <div className="grid md:grid-cols-3 gap-4">
          {([[Play, 'START SIMULATION', () => setScr('select')], [FlaskConical, 'SCENARIO LAB', () => { setScr('select'); setTimeout(() => document.getElementById('lab')?.scrollIntoView({ behavior: 'smooth' }), 50) }], [ClipboardList, 'AFTER-ACTION REVIEW', () => setScr('aar')]] as const).map(([I, l, f]) =>
            <button type="button" key={l} onClick={f} className="panel p-6 text-left hover:border-cyan-500 hover:shadow-[0_0_15px_rgba(34,211,238,0.15)] transition"><I className="text-cyan-400 mb-3" /><b>{l}</b></button>)}
        </div>
        <div className="grid md:grid-cols-4 gap-4">{([['Sessions Completed', hist.length], ['Detection Accuracy', avg('det')], ['Avg Reaction', avgRt], ['Classification Accuracy', avg('cls')]] as const).map(([k, v]) =>
          <div key={k} className="panel p-4"><div className="text-xs text-slate-400">{k}</div><div className={`mono text-2xl tabular-nums ${C.terminal}`}>{v}</div></div>)}</div>
        <div className="panel p-4 text-xs mono flex flex-wrap items-center gap-4">
          <span className="text-slate-400">TRAINING HISTORY: {hist.length} session{hist.length === 1 ? '' : 's'}{demoCount ? ` (${demoCount} demo)` : ''} · stored in this browser only</span>
          <Btn sub testid="load-demo" onClick={loadDemo}>LOAD DEMO DATA</Btn>
          <Btn sub disabled={!hist.length} testid="export-history" onClick={exportHistory}><Download className="inline w-4 h-4 mr-1" />EXPORT CSV</Btn>
          <Btn sub onClick={() => { if (window.confirm('Clear all stored training history?')) setHist([]) }}>CLEAR HISTORY</Btn>
        </div>
        {hist.length > 0 && <SessionsTable hist={hist} />}
      </main>}

      {scr === 'select' && <main className="flex-1 overflow-y-auto p-6 space-y-6 max-w-6xl mx-auto w-full">
        <div className="grid md:grid-cols-4 gap-4">{PRESETS.map((p, i) => <button type="button" key={p.name} onClick={() => go(mk(p))} className="panel p-5 text-left hover:border-cyan-500 hover:shadow-[0_0_15px_rgba(34,211,238,0.15)] transition">
          <div className={C.terminal}>SCENARIO 0{i + 1}</div><div className="font-bold text-lg my-1">{p.name.toUpperCase()}</div>
          <div className="text-xs text-slate-400 space-y-0.5"><div>{p.env} · {p.time}</div><div>{p.type} · Sensors {p.sensor}</div><div className={[C.good, C.warn, C.bad, C.bad][p.diff]}>{DIFFS[p.diff].toUpperCase()}</div></div></button>)}</div>
        <div id="lab" className="panel p-5"><div className="text-sm font-semibold mb-3">SCENARIO GENERATOR</div>
          <div className="flex flex-wrap gap-3 items-center">{sel('env', ['Urban', 'Rural', 'Mixed'])}{sel('time', ['Day', 'Night'])}{sel('sensor', ['Clear', 'Moderate', 'Degraded'])}{sel('type', ['Single', 'Multiple', 'Swarm'])}
            <select value={custom.diff} aria-label="difficulty" onChange={e => setCustom({ ...custom, diff: +e.target.value })} className="bg-[#0D141C] border border-slate-600 rounded px-2 py-1 text-sm">{DIFFS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
            <Btn onClick={() => go(mk(custom))}>GENERATE</Btn>
            <Btn sub onClick={() => go(mk({ name: 'Random Scenario', env: rand(['Urban', 'Rural', 'Mixed']), time: rand(['Day', 'Night']), sensor: rand(['Clear', 'Moderate', 'Degraded']), type: rand(['Single', 'Multiple', 'Swarm']), diff: Math.floor(Math.random() * 4) }))}><Shuffle className="inline w-4 h-4 mr-1" />RANDOM</Btn></div>
          <p className="text-xs text-slate-500 mt-3">Every launch uses a fresh random seed, so presets are never identical twice. Replay a seed from the After-Action Review.</p></div></main>}

      {scr === 'brief' && <main className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full"><div className="panel p-6 space-y-4">
        <div className={`mono text-xs tabular-nums ${C.terminal}`}>SCENARIO ID {sc.id} · SEED {sc.seed}</div><h2 className="text-2xl font-bold">{sc.name.toUpperCase()}</h2>
        <p className="text-slate-300">Identify incoming aerial contacts, classify each one, and select the appropriate response. Judge by IFF, route, altitude, speed and grouping. No single cue is always reliable.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm mono bg-black/20 p-4 rounded border border-slate-800">{([['Environment', sc.env], ['Visibility', sc.time], ['Sensors', sc.sensor], ['Difficulty', DIFFS[sc.diff]], ['Mission Limit', '02:00'], ['Seed', sc.seed]] as const).map(([k, v]) => <div key={k}><div className="text-xs text-slate-500">{k}</div><div className="tabular-nums font-semibold">{v}</div></div>)}</div>
        <div><div className="text-sm font-semibold mb-1 text-red-400">RULES OF ENGAGEMENT (training)</div><ul className="text-sm text-slate-400 list-disc ml-5 marker:text-red-400/50"><li>Assess before responding; classification is committed once chosen</li><li>Engaging a friendly track (blue-on-blue) is a critical failure</li><li>Passive responses do not stop a hostile track; it will reach the perimeter</li><li>Degraded sensors can produce false contacts: do not engage clutter</li><li>All decisions are evaluated for training purposes only</li></ul><p className="text-xs text-slate-500 mt-2">Sound alerts are synthesised in your browser (toggle in the header, or press M in a run). Every alert is also shown in the event log.</p></div>
        <label className="text-sm flex gap-2 p-3 bg-black/30 rounded border border-slate-800 cursor-pointer"><input type="checkbox" checked={blind} onChange={e => setBlind(e.target.checked)} className="accent-cyan-500" />Blind Mode (hide IFF, speed and confidence: judge by behaviour only)</label>
        <Btn onClick={() => setScr('sim')}>INITIALIZE SIMULATION</Btn></div></main>}

      {scr === 'sim' && <Simulation key={`${sc.id}-${sc.seed}-${hist.length}`} sc={sc} blind={blind} onDone={onDone} />}

      {scr === 'aar' && <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-6xl mx-auto w-full">
        {res && aar ? <>
          <div className="panel p-5 flex flex-wrap items-center gap-8"><Ring v={res.r.overall} />
            <div><div className={C.terminal}>AFTER-ACTION REVIEW</div><h2 className="text-2xl font-bold">{res.sc.name.toUpperCase()}</h2>
              <div className={`mt-1 font-mono text-sm ${res.r.ok ? C.good : C.bad}`}>{res.r.ok ? 'TRAINING OBJECTIVE COMPLETED' : res.r.fratricides ? 'OBJECTIVE FAILED: BLUE-ON-BLUE' : 'OBJECTIVE NOT MET: RETRAIN'}</div></div>
            <div className="grid grid-cols-3 gap-6 mono text-sm tabular-nums">{([['Detection', res.r.det + '%'], ['Classification', res.r.cls + '%'], ['Decision', res.r.dec + '%'], ['Avg Reaction', res.r.avg + 's'], ['Sit. Awareness', res.r.sa + '%'], ['Level', level]] as const).map(([k, v]) => <div key={k}><div className="text-xs text-slate-400 font-sans">{k}</div><span className="text-lg text-cyan-300">{v}</span></div>)}</div></div>
          <TrendCard data={chartData} options={chartOpts} n={hist.length} onExport={exportHistory} />
          <div className="panel p-5 overflow-x-auto"><div className="flex flex-wrap items-center justify-between gap-2 mb-2"><div className="text-sm font-semibold">WHAT-IF REPLAY · YOUR DECISION vs TRAINING REFERENCE</div><Btn sub testid="export-session" onClick={exportSession}><Download className="inline w-4 h-4 mr-1" />EXPORT SESSION CSV</Btn></div>
            <table className="w-full text-sm mono whitespace-nowrap"><thead className="text-xs text-slate-400 text-left bg-black/40"><tr><th className="p-2">TRACK</th><th className="p-2">TRUTH</th><th className="p-2">IFF</th><th className="p-2">YOUR CLASS</th><th className="p-2">YOUR DECISION</th><th className="p-2">REFERENCE</th><th className="p-2">OUTCOME</th><th className="p-2">REACTION</th></tr></thead><tbody>
              {rows.map(t => {
                const g = t.ghost
                const okC = g ? t.cls === 'UNKNOWN' || t.cls === undefined : clsCredit(t) === 1
                const okD = g ? !(t.dec === 'ALERT' || t.dec === 'SIM_ENGAGE') : t.dec === REF[t.truth]
                return <tr key={t.id} className="border-t border-[#1c2c3a] hover:bg-white/5">
                  <td className="p-2">{t.id}</td><td className="p-2">{g ? 'FALSE CONTACT' : t.truth}</td><td className="p-2">{t.iff === 'VALID' ? 'VALID' : 'NONE'}{!g && t.truth !== 'FRIENDLY' && t.iff === 'VALID' ? ' (SPOOFED)' : ''}</td>
                  <td className={`p-2 ${okC ? C.good : C.bad}`}>{t.cls ?? 'UNCLASSIFIED'}</td><td className={`p-2 ${okD ? C.good : C.bad}`}>{t.dec ?? '—'}</td>
                  <td className="p-2">{g ? 'INVESTIGATE / IGNORE' : REF[t.truth]}</td>
                  <td className={`p-2 ${t.status === 'NEUTRALISED' || t.status === 'DEPARTED' ? C.good : t.status === 'ACTIVE' ? C.warn : C.bad}`}>{t.status === 'ACTIVE' ? 'UNRESOLVED' : t.status}</td>
                  <td className="p-2 tabular-nums">{t.clsAt !== undefined ? (t.clsAt - t.appear).toFixed(1) + 's' : '—'}</td></tr>
              })}</tbody></table></div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="panel p-5 text-sm space-y-1"><div className="font-semibold mb-3 border-b border-slate-800 pb-2">WHAT WENT WELL / TO IMPROVE</div>
              {res.r.det >= 80 && <div className={C.good}>✓ Early, consistent detection</div>}{res.r.cls >= 80 && <div className={C.good}>✓ Accurate classification</div>}{res.r.rs >= 70 && <div className={C.good}>✓ Fast response</div>}
              {res.r.cls < 80 && <div className={C.warn}>⚠ Classification errors: weigh IFF against route, altitude and speed</div>}{res.r.dec < 80 && <div className={C.warn}>⚠ Response did not match training reference</div>}
              {res.r.breaches > 0 && <div className={C.bad}>⚠ {res.r.breaches} track(s) reached the perimeter: monitoring alone does not stop a hostile</div>}
              {res.r.fratricides > 0 && <div className={C.bad}>✗ Blue-on-blue: engaged a friendly track ({res.r.fratricides})</div>}
              {res.r.falseAlarms > 0 && <div className={C.warn}>⚠ {res.r.falseAlarms} false alarm(s): responded to sensor clutter</div>}
              {rows.some(t => !t.ghost && t.truth !== 'FRIENDLY' && t.iff === 'VALID' && t.cls === 'FRIENDLY') && <div className={C.warn}>⚠ Trusted a VALID squawk on a hostile (spoofed IFF): check route and altitude</div>}
              {rows.some(t => !t.ghost && t.truth === 'FRIENDLY' && t.iff === 'NONE' && t.cls?.startsWith('HOSTILE')) && <div className={C.warn}>⚠ Treated a friendly with a missing squawk as hostile: it held a steady orbit at friendly altitude</div>}</div>
            <div className="panel p-5 text-sm space-y-3"><div className="font-semibold flex gap-2 border-b border-slate-800 pb-2"><Brain className="w-4 h-4 text-cyan-400" />ADAPTIVE COACH (rule-based)</div>
              <p className="text-slate-300">Weakest area: <b>{aar.focus}</b>. The next session is set to {DIFFS[aar.next.diff]} ({aar.next.type}, {aar.next.sensor} sensors) to target it.</p>
              <div className="text-xs mono text-slate-400 bg-black/30 p-2 rounded tabular-nums">NEXT LEVEL {aar.nextDiff + 1} · FOCUS: {aar.focus}</div>
              <div className="flex flex-wrap gap-2"><Btn onClick={() => go(aar.next)}><RefreshCw className="inline w-4 h-4 mr-1" />NEXT TRAINING SESSION</Btn>
                <Btn sub onClick={() => go(generate(res.sc, res.sc.seed, stress()))}><RotateCcw className="inline w-4 h-4 mr-1" />REPLAY SAME SEED</Btn></div></div></div>
        </> : <>
          <div className="panel p-5"><div className={C.terminal}>AFTER-ACTION REVIEW</div>
            <p className="text-slate-300 mt-2">{hist.length ? 'Training history from this browser. Complete a new session for a full replay analysis.' : 'No sessions yet. Complete a simulation to generate your first After-Action Review.'}</p>
            <div className="mt-3"><Btn onClick={() => setScr('select')}>START SIMULATION</Btn></div></div>
          {hist.length > 0 && <TrendCard data={chartData} options={chartOpts} n={hist.length} onExport={exportHistory} />}
          {hist.length > 0 && <SessionsTable hist={hist} />}
        </>}
      </main>}
      <div role="status" aria-live="polite" data-testid="toast" className={`fixed bottom-4 right-4 z-[60] panel px-4 py-2 text-xs mono ${note ? '' : 'hidden'}`}>{note}</div>
    </div>
  )
}

function TrendCard({ data, options, n, onExport }: { data: ChartData<'line'>; options: ChartOptions<'line'>; n: number; onExport: () => void }) {
  return (
    <div className="panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2"><div className="text-sm font-semibold">LONG-TERM PERFORMANCE TRENDS</div>
        <Btn sub disabled={!n} testid="export-history-trend" onClick={onExport}><Download className="inline w-4 h-4 mr-1" />EXPORT HISTORY CSV</Btn></div>
      <div className="w-full h-48 bg-black/20 rounded p-2 border border-slate-800">
        {n ? <Line data={data} options={options} /> : <div className="h-full flex items-center justify-center text-sm text-slate-500">Complete a session to see trends.</div>}
      </div>
    </div>
  )
}

/** Newest sessions first, numbered to match the trend chart. Demo rows are visibly labelled. */
function SessionsTable({ hist }: { hist: Rec[] }) {
  const rows = hist.map((h, i) => ({ h, n: i + 1 })).reverse().slice(0, 8)
  return (
    <div className="panel p-5 overflow-x-auto" data-testid="sessions-table">
      <div className="text-sm font-semibold mb-2">RECENT SESSIONS{hist.length > 8 ? ` (latest 8 of ${hist.length})` : ''}</div>
      <table className="w-full text-xs mono whitespace-nowrap">
        <thead className="text-slate-400 text-left bg-black/40"><tr><th className="p-2">#</th><th className="p-2">SCENARIO</th><th className="p-2">LEVEL</th><th className="p-2">SCORE</th><th className="p-2">DETECT</th><th className="p-2">CLASSIFY</th><th className="p-2">DECISION</th><th className="p-2">REACTION</th><th className="p-2">SOURCE</th></tr></thead>
        <tbody>{rows.map(({ h, n }) => (
          <tr key={h.ts + '-' + n} data-testid="session-row" className="border-t border-[#1c2c3a] tabular-nums">
            <td className="p-2">{n}</td><td className="p-2">{h.scenario}</td><td className="p-2">{h.diff + 1}</td>
            <td className={`p-2 ${h.overall >= 60 ? C.good : C.bad}`}>{h.overall}</td><td className="p-2">{h.det}%</td><td className="p-2">{h.cls}%</td><td className="p-2">{h.dec}%</td><td className="p-2">{h.avg}s</td>
            <td className={`p-2 ${h.demo ? C.warn : 'text-cyan-300'}`}>{h.demo ? 'DEMO' : 'OPERATOR'}</td>
          </tr>))}</tbody>
      </table>
    </div>
  )
}