import { describe, expect, it } from 'vitest'
import { cell, historyCsv, sessionCsv, stamp, toCsv } from '../src/csv'
import { demoHist, generate, newSim, step, classify, decide, ack, isVisible, type Rec } from '../src/sim'

/** minimal RFC 4180 parser used to prove the output round-trips */
function parse(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, ''); const rows: string[][] = []; let row: string[] = [], f = '', q = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\r' && t[i + 1] === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++ }
    else f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  return rows
}

describe('cell()', () => {
  it('quotes commas, quotes and newlines (RFC 4180)', () => {
    expect(cell('a,b')).toBe('"a,b"'); expect(cell('say "hi"')).toBe('"say ""hi"""'); expect(cell('l1\nl2')).toBe('"l1\nl2"'); expect(cell('plain')).toBe('plain')
  })
  it('neutralises spreadsheet formula injection in text but leaves real numbers alone', () => {
    for (const bad of ['=SUM(A1:A9)', '+1+1', '-2+3', '@cmd', '\tx', '\rx', '=HYPERLINK("http://evil","x")']) expect(cell(bad).replace(/^"/, '').startsWith("'"), bad).toBe(true)
    expect(cell(-5)).toBe('-5'); expect(cell(0.5)).toBe('0.5')
  })
  it('handles null, undefined, booleans, NaN and Infinity', () => {
    expect(cell(null)).toBe(''); expect(cell(undefined)).toBe(''); expect(cell(true)).toBe('YES'); expect(cell(false)).toBe('NO'); expect(cell(NaN)).toBe(''); expect(cell(Infinity)).toBe('')
  })
  it('no parsed cell can ever start with a formula trigger (fuzz)', () => {
    const alphabet = ['=', '+', '-', '@', '\t', '\r', '\n', ',', '"', 'a', ' ', '1']; let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let n = 0; n < 500; n++) {
      const s = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join('')
      const out = parse(toCsv([[s, 'x']]))[0][0]
      expect(/^[=+\-@\t\r]/.test(out), JSON.stringify(s)).toBe(false)
    }
  })
})

describe('toCsv()', () => {
  it('adds a UTF-8 BOM for Excel, CRLF line endings and a trailing newline', () => {
    const out = toCsv([['a', 'b'], [1, 2]]); expect(out.charCodeAt(0)).toBe(0xfeff); expect(out).toBe('\uFEFFa,b\r\n1,2\r\n')
  })
  it('round-trips awkward text exactly (aside from the injection guard)', () => {
    const rows = [['x,y', 'q"uote', 'multi\nline', 'ok'], ['', 'é · —', '1', '2']]
    expect(parse(toCsv(rows))).toEqual(rows)
  })
})

describe('historyCsv()', () => {
  const real: Rec = { det: 90, cls: 80, dec: 70, avg: 4.2, rs: 75, sa: 88, overall: 81, fratricides: 0, falseAlarms: 1, breaches: 0, ok: true, ts: Date.UTC(2026, 9, 14, 8, 30), scenario: 'Night Intrusion', diff: 1, seed: 123456, nextDiff: 2 }
  it('has one header plus one row per session with consistent column counts', () => {
    const rows = parse(historyCsv([...demoHist(), real])); expect(rows).toHaveLength(7)
    for (const r of rows) expect(r).toHaveLength(rows[0].length)
  })
  it('labels demo data and real data differently so exports cannot be mistaken', () => {
    const rows = parse(historyCsv([...demoHist(), real])), col = rows[0].indexOf('data_source')
    expect(rows.slice(1, 6).every(r => r[col] === 'DEMO')).toBe(true); expect(rows[6][col]).toBe('OPERATOR')
  })
  it('writes ISO-8601 UTC timestamps, 1-based levels and YES/NO flags', () => {
    const r = parse(historyCsv([real])), h = r[0], d = r[1]
    expect(d[h.indexOf('completed_at_utc')]).toBe('2026-10-14T08:30:00.000Z'); expect(d[h.indexOf('level')]).toBe('2'); expect(d[h.indexOf('next_level')]).toBe('3')
    expect(d[h.indexOf('objective_met')]).toBe('YES'); expect(d[h.indexOf('overall_score')]).toBe('81'); expect(d[h.indexOf('difficulty')]).toBe('Medium')
  })
  it('exports an empty history as just the header (no crash)', () => { expect(parse(historyCsv([]))).toHaveLength(1) })
  it('stamp() gives a filesystem-safe timestamp', () => { expect(stamp(new Date('2026-10-14T08:30:45Z'))).toBe('20261014-0830') })
})

describe('sessionCsv()', () => {
  it('exports every seen contact with ground truth, operator action, reference and outcome; ghosts are flagged', () => {
    const sc = generate({ name: 'Swarm Breach', env: 'Mixed', time: 'Day', sensor: 'Degraded', type: 'Swarm', diff: 3 }, 21)
    const sim = newSim(sc)
    for (let i = 0; i < 30 * 45; i++) step(sim, 1 / 30)
    const k = sim.tracks.find(t => !t.ghost && isVisible(sim, t))!
    ack(sim, [k.id]); classify(sim, [k.id], 'HOSTILE_SINGLE'); decide(sim, [k.id], 'ALERT')
    const rows = parse(sessionCsv(sc, sim.tracks)), h = rows[0]
    for (const r of rows) expect(r).toHaveLength(h.length)
    expect(rows.length - 1).toBe(sim.tracks.filter(t => t.seen).length)
    const types = new Set(rows.slice(1).map(r => r[h.indexOf('contact_type')]))
    expect(types.has('REAL')).toBe(true); expect(types.has('FALSE_CONTACT')).toBe(true)
    const mine = rows.find(r => r[h.indexOf('track_id')] === k.id)!
    expect(mine[h.indexOf('operator_class')]).toBe('HOSTILE_SINGLE'); expect(mine[h.indexOf('operator_decision')]).toBe('ALERT')
    expect(mine[h.indexOf('ground_truth')]).toBe(k.truth)
    for (const r of rows.slice(1).filter(r => r[h.indexOf('contact_type')] === 'FALSE_CONTACT')) expect(r[h.indexOf('ground_truth')]).toBe('SENSOR_CLUTTER')
  })
})
