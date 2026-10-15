// CSV export for AAR data. Pure functions (testable) plus one browser-only download helper.
// Safe for Excel/Sheets: RFC 4180 quoting, CRLF line endings, UTF-8 BOM, and spreadsheet-formula injection guard.
import { DIFFS, REF, clsCredit, type Rec, type Scenario, type Track } from './sim'

export type Cell = string | number | boolean | null | undefined

/** One CSV field. Text starting with = + - @ TAB or CR is prefixed with ' so a spreadsheet cannot execute it as a formula. */
export function cell(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = typeof v === 'boolean' ? (v ? 'YES' : 'NO') : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
export const toCsv = (rows: Cell[][]) => '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'

const iso = (t: number) => new Date(t).toISOString()
export const stamp = (d = new Date()) => d.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')

/** One row per completed session (the AAR history). Demo rows are labelled so they can never be mistaken for real operator data. */
export function historyCsv(hist: Rec[]): string {
  const head = ['session_no', 'completed_at_utc', 'scenario', 'difficulty', 'level', 'seed', 'overall_score', 'detection_pct', 'classification_pct', 'decision_pct',
    'avg_reaction_s', 'reaction_score', 'situational_awareness', 'perimeter_breaches', 'blue_on_blue', 'false_alarms', 'objective_met', 'next_level', 'data_source']
  return toCsv([head, ...hist.map((h, i) => [i + 1, iso(h.ts), h.scenario, DIFFS[h.diff] ?? h.diff, h.diff + 1, h.seed, h.overall, h.det, h.cls, h.dec,
    h.avg, h.rs, h.sa, h.breaches, h.fratricides, h.falseAlarms, h.ok, h.nextDiff + 1, h.demo ? 'DEMO' : 'OPERATOR'])])
}

/** One row per contact in a session: what it really was, what the operator did, and the training reference. */
export function sessionCsv(sc: Scenario, tracks: Track[]): string {
  const head = ['scenario', 'seed', 'track_id', 'contact_type', 'ground_truth', 'iff_squawk', 'iff_spoofed', 'altitude_m', 'speed_kmh', 'first_seen_s',
    'operator_class', 'operator_decision', 'reference_decision', 'class_correct', 'decision_correct', 'reaction_s', 'outcome']
  const rows = tracks.filter(t => t.seen).map(t => {
    const g = t.ghost
    return [sc.name, sc.seed, t.id, g ? 'FALSE_CONTACT' : 'REAL', g ? 'SENSOR_CLUTTER' : t.truth, t.iff, !g && t.truth !== 'FRIENDLY' && t.iff === 'VALID',
      t.altitude, t.speed, +t.appear.toFixed(1), t.cls ?? 'UNCLASSIFIED', t.dec ?? '', g ? 'INVESTIGATE_OR_IGNORE' : REF[t.truth],
      g ? t.cls === 'UNKNOWN' || t.cls === undefined : clsCredit(t) === 1,
      g ? !(t.dec === 'ALERT' || t.dec === 'SIM_ENGAGE') : t.dec === REF[t.truth],
      t.clsAt !== undefined ? +(t.clsAt - t.appear).toFixed(1) : '', t.status === 'ACTIVE' ? 'UNRESOLVED' : t.status] as Cell[]
  })
  return toCsv([head, ...rows])
}

/** Browser download via Blob. Returns false (instead of throwing) if the browser blocks it. */
export function download(filename: string, text: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.style.display = 'none'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch { return false }
}
