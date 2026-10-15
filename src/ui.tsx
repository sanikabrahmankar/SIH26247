import { useSyncExternalStore, type ReactNode } from 'react'
import { Volume2, VolumeX } from 'lucide-react'
import { isMuted, play, subscribeMute, toggleMuted, unlock } from './audio'

export const C = { good: 'text-emerald-400', warn: 'text-amber-400', bad: 'text-red-400', terminal: 'text-cyan-400 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]' }

type BtnProps = { children: ReactNode; onClick?: () => void; sub?: boolean; active?: boolean; disabled?: boolean; testid?: string; title?: string }
export const Btn = ({ children, onClick, sub, active, disabled, testid, title }: BtnProps) => (
  <button
    type="button" onClick={onClick} disabled={disabled} data-testid={testid} title={title}
    className={`px-4 py-2 rounded border text-sm tracking-wide transition select-none disabled:opacity-40 disabled:cursor-not-allowed ${
      active ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
        : sub ? `border-slate-600 ${disabled ? '' : 'hover:border-cyan-500'}`
        : `bg-cyan-500 text-black border-cyan-400 font-semibold ${disabled ? '' : 'hover:bg-cyan-300 hover:shadow-[0_0_15px_rgba(34,211,238,0.6)]'}`}`}>
    {children}
  </button>
)

export const Ring = ({ v }: { v: number }) => (
  <svg viewBox="0 0 120 120" className="w-40 h-40" role="img" aria-label={`Overall score ${v} out of 100`}>
    <circle cx="60" cy="60" r="52" fill="none" stroke="#1c2c3a" strokeWidth="8" />
    <circle cx="60" cy="60" r="52" fill="none" stroke={v > 75 ? '#34d399' : v > 50 ? '#fbbf24' : '#f87171'} strokeWidth="8" strokeLinecap="round"
      strokeDasharray={`${v * 3.27} 327`} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dasharray 1.2s' }} />
    <text x="60" y="68" textAnchor="middle" fill="#e6f6fb" fontSize="30" className="mono">{v}</text>
  </svg>
)

export const mmss = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${(x % 60).toFixed(1).padStart(4, '0')}`

export const useMuted = () => useSyncExternalStore(subscribeMute, isMuted, () => false)

/** Global sound switch (also bound to the M key during a simulation). The click is a user gesture, so it unlocks audio. */
export function SoundToggle() {
  const muted = useMuted()
  return (
    <button
      type="button" data-testid="sound-toggle" aria-pressed={!muted}
      aria-label={muted ? 'Sound is off. Turn sound on' : 'Sound is on. Turn sound off'}
      title="Toggle sound alerts (M)"
      onClick={() => { unlock(); toggleMuted(); if (!isMuted()) play('decide') }}
      className="flex items-center gap-1 border border-slate-600 rounded px-2 py-0.5 text-xs mono hover:border-cyan-500">
      {muted ? <VolumeX className="w-3.5 h-3.5 text-slate-400" /> : <Volume2 className="w-3.5 h-3.5 text-cyan-300" />}
      <span className="hidden sm:inline">SOUND {muted ? 'OFF' : 'ON'}</span>
    </button>
  )
}
