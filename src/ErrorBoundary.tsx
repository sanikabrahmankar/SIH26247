import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; onReload?: () => void }
type State = { error: Error | null }

/** Last line of defence: a render error shows a recovery screen instead of a blank page. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('AEGIS-X crashed:', error, info.componentStack) }
  private reload = () => (this.props.onReload ?? (() => location.reload()))()
  private reset = () => {
    try { Object.keys(localStorage).filter(k => k.startsWith('aegis_')).forEach(k => localStorage.removeItem(k)) } catch { /* storage blocked */ }
    this.reload()
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" className="h-dvh w-screen flex items-center justify-center bg-[#070B10] text-[#cfe3ea] p-6">
        <div className="max-w-md w-full border border-red-500/40 bg-[#0D141C] rounded-lg p-6 space-y-4">
          <div className="text-red-400 font-semibold tracking-widest">AEGIS-X · SOMETHING WENT WRONG</div>
          <p className="text-sm text-slate-300">The display hit an unexpected error. Saved training data in this browser may be damaged. Clearing it fixes most causes.</p>
          <pre className="text-xs text-slate-400 bg-black/40 p-2 rounded overflow-x-auto whitespace-pre-wrap">{this.state.error.message}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" data-testid="eb-reset" onClick={this.reset} className="px-4 py-2 rounded bg-cyan-500 text-black font-semibold text-sm">CLEAR SAVED DATA AND RELOAD</button>
            <button type="button" data-testid="eb-reload" onClick={this.reload} className="px-4 py-2 rounded border border-slate-600 text-sm">RELOAD</button>
          </div>
        </div>
      </div>
    )
  }
}