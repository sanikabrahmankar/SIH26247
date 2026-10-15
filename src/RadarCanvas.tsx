import { useEffect, useRef, type MutableRefObject } from 'react'
import { R, headingOf, isVisible, type Sim, type Track } from './sim'

type Props = {
  simRef: MutableRefObject<Sim>
  selected: string[]
  night: boolean
  blind: boolean
  showFps?: boolean
  onPick: (id: string | null, additive: boolean) => void
}

const PAL = {
  day: { bg: '#0a1017', ring: '#1c3a3a', txt: '#2f5c5c', sweep: '34,211,238', zone: '#415568', vignette: 0 },
  night: { bg: '#03070b', ring: '#113030', txt: '#1d4545', sweep: '52,211,153', zone: '#26384a', vignette: 0.55 },
}
const COL = { raw: '#22d3ee', friend: '#34d399', hostile: '#f87171', unknown: '#fbbf24' } // semantic colours are identical day and night
const colorOf = (k: Track) => (k.cls === 'FRIENDLY' ? COL.friend : k.cls?.startsWith('HOSTILE') ? COL.hostile : k.cls ? COL.unknown : COL.raw)
const TAU = Math.PI * 2

export default function RadarCanvas({ simRef, selected, night, blind, showFps, onPick }: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const geo = useRef({ w: 0, h: 0, dpr: 1, s: 1, cx: 0, cy: 0 })
  // latest props for the draw loop without restarting it
  const live = useRef({ selected, night, blind, showFps })
  live.current = { selected, night, blind, showFps }
  const reduced = useRef(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)

  // ---- resize: keep the backing store in sync with CSS size and devicePixelRatio ----
  useEffect(() => {
    const el = wrap.current, c = cv.current
    if (!el || !c) return
    const apply = (w: number, h: number) => {
      if (w < 10 || h < 10) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2) // cap: 3x phones would triple fill cost for little gain
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
      c.style.width = w + 'px'; c.style.height = h + 'px'
      geo.current = { w, h, dpr, s: Math.min(w, h) / 2 / (R + 8), cx: w / 2, cy: h / 2 }
    }
    const measure = () => { const r = el.getBoundingClientRect(); apply(r.width, r.height) }
    measure()
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(es => { const r = es[0].contentRect; apply(r.width, r.height) }); ro.observe(el) }
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('orientationchange', measure) }
  }, [])

  // ---- draw loop: reads simulation state from the ref; React never re-renders per frame ----
  useEffect(() => {
    const c = cv.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    let raf = 0, frames = 0, fps = 0, fpsAt = performance.now()
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const { w, h, dpr, s, cx, cy } = geo.current
      if (!w) return
      const sim = simRef.current, t = sim.t
      const { selected: sel, night: isNight, blind: isBlind, showFps: fpsOn } = live.current
      const P = isNight ? PAL.night : PAL.day
      const X = (x: number) => cx + x * s, Y = (y: number) => cy + y * s
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = P.bg; ctx.fillRect(0, 0, w, h)

      // range rings, crosshair, compass
      ctx.lineWidth = 1; ctx.strokeStyle = P.ring
      for (const r of [25, 50, 75, 95]) { ctx.beginPath(); ctx.arc(cx, cy, r * s, 0, TAU); ctx.stroke() }
      ctx.beginPath(); ctx.moveTo(cx - 96 * s, cy); ctx.lineTo(cx + 96 * s, cy); ctx.moveTo(cx, cy - 96 * s); ctx.lineTo(cx, cy + 96 * s); ctx.stroke()
      ctx.fillStyle = P.txt; ctx.font = `${Math.max(9, 5 * s)}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('000', cx, cy - 99 * s); ctx.fillText('180', cx, cy + 99 * s); ctx.fillText('090', cx + 99 * s, cy); ctx.fillText('270', cx - 99 * s, cy)
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#ef444455'; ctx.beginPath(); ctx.arc(cx, cy, 8 * s, 0, TAU); ctx.stroke(); ctx.setLineDash([]) // breach perimeter

      // urban clutter zones
      for (const z of sim.zones) {
        ctx.fillStyle = P.zone + '33'; ctx.strokeStyle = P.zone; ctx.setLineDash([3, 4])
        ctx.beginPath(); ctx.arc(X(z.x), Y(z.y), z.r * s, 0, TAU); ctx.fill(); ctx.stroke(); ctx.setLineDash([])
      }

      // sweep wedge with fading tail (compass angle 0 = up, clockwise; canvas angle 0 = east)
      const sw = ((t % 4) / 4) * TAU
      for (let i = 0; i < 20; i++) {
        const a1 = sw - i * 0.045 - Math.PI / 2, a0 = a1 - 0.045
        ctx.fillStyle = `rgba(${P.sweep},${0.16 * (1 - i / 20)})`
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, 95 * s, a1, a0, true); ctx.closePath(); ctx.fill()
      }
      ctx.fillStyle = COL.friend; ctx.beginPath(); ctx.arc(cx, cy, 2.5 * s, 0, TAU); ctx.fill()

      // tracks
      const selSet = new Set(sel)
      let nLive = 0
      for (const k of sim.tracks) if (isVisible(sim, k)) nLive++
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'
      for (const k of sim.tracks) {
        if (k.status === 'ACTIVE' && t >= k.appear && t < k.lostUntil) { // dropout: last-known marker only
          ctx.strokeStyle = '#64748b'; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.arc(X(k.dx), Y(k.dy), 7, 0, TAU); ctx.stroke(); ctx.setLineDash([])
          ctx.fillStyle = '#64748b'; ctx.font = '10px ui-monospace, monospace'; ctx.fillText('LOST', X(k.dx) + 10, Y(k.dy) + 3)
          continue
        }
        if (!isVisible(sim, k)) continue
        const col = colorOf(k), px = X(k.dx), py = Y(k.dy), isSel = selSet.has(k.id)
        const bearing = ((headingOf(k.x, k.y) * Math.PI) / 180) % TAU
        const fade = 1 - ((((sw - bearing) % TAU) + TAU) % TAU) / TAU // phosphor persistence: brightest just after the sweep
        ctx.globalAlpha = isSel ? 1 : 0.55 + 0.45 * fade
        // trail
        ctx.fillStyle = col
        for (let i = 0; i < k.trail.length; i += 2) { ctx.globalAlpha = (isSel ? 0.5 : 0.28) * ((i + 2) / k.trail.length); ctx.fillRect(X(k.trail[i]) - 1, Y(k.trail[i + 1]) - 1, 2, 2) }
        ctx.globalAlpha = isSel ? 1 : 0.55 + 0.45 * fade
        // velocity vector
        ctx.strokeStyle = col; ctx.setLineDash([3, 3]); ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + k.vx * 4 * s, py + k.vy * 4 * s); ctx.stroke(); ctx.setLineDash([])
        // blip
        const rr = Math.max(6, 3.2 * s)
        if (isSel) {
          const p = rr + 4 + Math.sin(t * 6) * 1.5
          ctx.lineWidth = 2; ctx.beginPath()
          ctx.moveTo(px - p, py - p + 5); ctx.lineTo(px - p, py - p); ctx.lineTo(px - p + 5, py - p)
          ctx.moveTo(px + p - 5, py - p); ctx.lineTo(px + p, py - p); ctx.lineTo(px + p, py - p + 5)
          ctx.moveTo(px - p, py + p - 5); ctx.lineTo(px - p, py + p); ctx.lineTo(px - p + 5, py + p)
          ctx.moveTo(px + p - 5, py + p); ctx.lineTo(px + p, py + p); ctx.lineTo(px + p, py + p - 5); ctx.stroke(); ctx.lineWidth = 1
        } else { ctx.beginPath(); ctx.arc(px, py, rr, 0, TAU); ctx.stroke() }
        ctx.beginPath(); ctx.arc(px, py, Math.max(2.5, 1.4 * s), 0, TAU); ctx.fill()
        // labels: id + altitude always; speed/heading when selected or when the picture is uncluttered
        ctx.shadowColor = '#000'; ctx.shadowBlur = 3; ctx.font = '11px ui-monospace, Menlo, monospace'
        ctx.fillText(`${k.id}  ${k.altitude}m`, px + rr + 4, py - 3)
        if (isSel || nLive <= 3) {
          ctx.globalAlpha *= 0.85
          ctx.fillText(`HDG ${String(Math.round(k.heading) % 360).padStart(3, '0')}°${isBlind ? '' : ' · ' + k.speed + 'km/h'}`, px + rr + 4, py + 9)
        }
        ctx.shadowBlur = 0; ctx.globalAlpha = 1
      }

      // outcome effects
      for (const k of sim.tracks) {
        if (k.endAt === undefined || t - k.endAt > 1) continue
        const age = (t - k.endAt) / 1, x = X(k.ex), y = Y(k.ey)
        const col = k.status === 'NEUTRALISED' ? COL.friend : k.status === 'DEPARTED' ? '#64748b' : COL.hostile
        ctx.globalAlpha = 1 - age; ctx.strokeStyle = col; ctx.lineWidth = 2
        ctx.beginPath(); ctx.arc(x, y, 6 + age * 26, 0, TAU); ctx.stroke(); ctx.lineWidth = 1; ctx.globalAlpha = 1
      }

      // degraded-sensor speckle (cheap, drawn in-canvas; no CSS filter)
      if (sim.sc.sensor !== 'Clear' && !reduced.current) {
        const n = sim.sc.sensor === 'Degraded' ? 90 : 30
        ctx.fillStyle = 'rgba(160,220,230,0.22)'
        for (let i = 0; i < n; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5)
      }
      if (P.vignette) {
        const g = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.3, cx, cy, Math.max(w, h) * 0.75)
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${P.vignette})`); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
      }
      if (sim.flash && t - sim.flash.at < 1.3) {
        const a = 1 - (t - sim.flash.at) / 1.3
        ctx.fillStyle = `rgba(248,113,113,${0.18 * a})`; ctx.fillRect(0, 0, w, h)
        ctx.globalAlpha = a; ctx.fillStyle = sim.flash.color; ctx.font = 'bold 20px ui-monospace, monospace'; ctx.textAlign = 'center'
        ctx.fillText(sim.flash.text, cx, 34); ctx.globalAlpha = 1; ctx.textAlign = 'left'
      }
      ctx.fillStyle = P.txt; ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'
      ctx.fillText(isNight ? 'NIGHT · NO VISUAL' : 'DAYLIGHT', 8, h - 8)
      ctx.fillText(`${sim.sc.sensor.toUpperCase()} SENSORS`, 8, h - 20)

      frames++
      const now = performance.now()
      if (now - fpsAt >= 500) { fps = Math.round((frames * 1000) / (now - fpsAt)); frames = 0; fpsAt = now }
      if (fpsOn) { ctx.fillStyle = '#facc15'; ctx.textAlign = 'right'; ctx.fillText(`${fps} FPS · ${nLive} tracks`, w - 8, h - 8) }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [simRef])

  // ---- pointer picking (works for mouse and touch; hit radius is in screen pixels, not world units) ----
  const nearest = (clientX: number, clientY: number, maxPx: number): string | null => {
    const c = cv.current
    if (!c) return null
    const rect = c.getBoundingClientRect(), { s, cx, cy } = geo.current, sim = simRef.current
    const mx = clientX - rect.left, my = clientY - rect.top
    let best: string | null = null, bd = maxPx
    for (const k of sim.tracks) {
      if (!isVisible(sim, k)) continue
      const d = Math.hypot(cx + k.dx * s - mx, cy + k.dy * s - my)
      if (d < bd) { bd = d; best = k.id }
    }
    return best
  }
  return (
    <div ref={wrap} className="relative w-full h-full min-h-[240px]">
      <canvas
        ref={cv}
        role="img"
        aria-label="Radar display. Use Tab to cycle tracks, 1 to 4 to classify or respond, Space to pause."
        data-testid="radar"
        className="absolute inset-0 cursor-crosshair"
        style={{ touchAction: 'none' }}
        onPointerDown={e => { e.preventDefault(); onPick(nearest(e.clientX, e.clientY, e.pointerType === 'touch' ? 30 : 18), e.shiftKey || e.ctrlKey || e.metaKey) }}
        onPointerMove={e => { if (e.pointerType === 'mouse' && cv.current) cv.current.style.cursor = nearest(e.clientX, e.clientY, 18) ? 'pointer' : 'crosshair' }}
      />
    </div>
  )
}

