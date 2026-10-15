# AEGIS-X · Drone & Counter-Drone Threat Simulation Trainer

A software-only training simulator (SIH26247). Operators detect, classify and respond to drone and swarm contacts under day/night and degraded-sensor conditions, then review their performance in an After-Action Review (AAR). Runs entirely in the browser: no backend, no accounts, no network calls.

**Stack:** React 18 · Vite 6 · TypeScript (strict) · Tailwind v4 · Chart.js 4 · HTML5 Canvas · Web Audio API.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 68 tests (simulation logic, audio, CSV, UI behaviour)
npm run typecheck  # tsc --strict
npm run build      # -> dist/ (deploy anywhere static; base is './')
```

## How to play
Click a blip to select its **cluster**, classify it, then choose a response. Judge by IFF squawk (spoofable), route shape, altitude, speed and grouping. Engaging a friendly (blue-on-blue) fails the mission; MONITOR does not stop a hostile; sensor clutter must not be engaged.

| Key | Action |
|---|---|
| Click / Shift-click | select cluster / add or remove a track |
| `Tab` | next track (nearest first) |
| `1`–`4` | classify, then respond (matches the button numbers) |
| `Space` | pause / resume (also automatic when the tab is hidden or the window loses focus) |
| `M` | mute / unmute sound |
| `Esc` | clear selection |

## Sound alerts
Synthesised with the Web Audio API (no audio files). Distinct tones for new contact, classification, decision, neutralised, perimeter breach, blue-on-blue, false alarm and mission complete. Browsers block audio until a gesture, so sound starts after your first click or key press. Toggle with the header button or `M`; the choice is remembered. Sound is additive only: every alert is also in the event log and as an on-screen flash. (An iPhone in silent mode can mute Web Audio.)

## CSV export
- **Export CSV** (home) / **Export history CSV** (AAR): one row per completed session: score, detection, classification, decision, reaction time, breaches, blue-on-blue, false alarms, objective met, level, seed, UTC timestamp. Demo rows are labelled `DEMO`; real runs are `OPERATOR`.
- **Export session CSV** (AAR): one row per contact: ground truth, IFF squawk and whether it was spoofed, operator class and decision, training reference, correctness, reaction time, outcome. False contacts are flagged `FALSE_CONTACT`.
- Files are UTF-8 with BOM (opens correctly in Excel), RFC 4180 quoted, and text cells that start with `= + - @` are neutralised against spreadsheet formula injection.

## URL options
`/?debug` shows FPS and track count and exposes the simulation on `window.__aegis`. `/?stress=300` forces 300 tracks (capped at 1500).

## Honest notes
- "Adaptive" difficulty is a rule-based expert system with seeded procedural scenarios. There is no machine learning, by design: it is explainable and replayable (same seed = same scenario, including dropouts and clutter).
- History lives in this browser's localStorage only. There is no unit-level aggregation (single operator).
