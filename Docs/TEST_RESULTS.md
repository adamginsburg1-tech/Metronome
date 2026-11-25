# Test results

Only results that were actually run are recorded here. Thresholds in the plan
are targets until evidence appears in this file.

## 2026-11-25 · Domain timing tests (Linux)

- **Environment:** Swift 6.0 (`swift:6.0-noble` Docker image), Ubuntu 24.04 x86_64, debug build
- **Command:** `swift test`
- **Result:** 28 tests, 0 failures (≈1.7 s)

| Area | What was checked | Result |
|---|---|---|
| Exact grids | 60/120/300 BPM 4/4 at 48 kHz land on exact frames; 7/8 (2+2+3); 6/8 dotted-quarter | Pass |
| All combinations | 10 meters × subdivisions 1–8 × 6 tempos (20–300, incl. 113.37, 187.5) × 44.1/48/96 kHz, 20 s each: every onset within ½ frame; event counts exact | Pass |
| 60-minute drift | Septuplets at 113.37 BPM, 48 kHz: max onset error ≤ 0.5 frame over 1 h. Naive rounded-interval accumulation drifts > 100 frames over the same run | Pass |
| Lookahead windows | Random windows 1–8820 frames over 2 min (7/8, quintuplets, 241.3 BPM, count-in) equal one full scan; no duplicates | Pass |
| Deep window | Window at 50 min equals full scan | Pass |
| Count-in / muting | Count-in bar −1 then bar 0 downbeat; muted units silent but grid intact | Pass |
| Tempo change | Change queued at next bar: earlier events identical, new tempo exact from the bar | Pass |
| Many changes | 180 consecutive +1 BPM changes (septuplets, 44.1 kHz) stay within ½ frame of reference; no overflow | Pass |
| Validation | Bad meters, groupings, subdivisions, tempos, sample rates, plans rejected | Pass |

**Not yet tested (needs Mac/iPad):** real playback, latency, transport stop
response, audio session interruptions, UI, accessibility.

## 2026-11-25 · Web test: timing core and browser smoke test (Linux)

- **Environment:** Node 22.23, headless Chromium (Playwright), Ubuntu 24.04. Not an iPad.
- **Timing core:** `node --test 'web/test/*.test.js'`, 11 tests, 0 failures. Covers exact
  60/120/300 BPM grids, meter defaults matching Swift, 6/8 dotted quarter,
  septuplets at 113.37 BPM within 1 µs over an hour, random adjacent windows
  with no repeats or gaps, count-in, muting, tempo and meter changes at the next bar.
- **Smoke test** (home-screen build served locally, 1180×820):
  Start → Running; +5 BPM while playing queued for the next bar and applied;
  11 clicks scheduled in ~5 s, 0 missed, worst timer gap 37 ms, tightest lead 120 ms;
  offline copy installed and controlling the page; Stop → Ready; no console
  errors; no horizontal overflow at 390 px wide. Wake lock is refused in headless
  Chromium (expected).

**Not yet tested:** anything on the iPad, which is the point of the test. See
the checklist in the page.

## 2026-11-25 · Web test: keep screen awake (headless Chromium)

Modes Off / While playing / Always checked with Wake Lock refused (fallback
silent video plays) and with Wake Lock granted (simulated): correct method and
status text in every mode, released on Stop in "While playing", released when
set to Off, no console errors. Not yet checked on the iPad.

## 2026-11-25 · Web test: browser detection (headless Chromium, spoofed identities)

Chrome on iPad, Safari on iPad (desktop-mode user agent + touch), Chrome on a
computer and Chrome on Android are each identified correctly with the right
engine and install steps; playback starts with 0 missed clicks and keep-awake
active in each. Only the engine of desktop Chrome was real; the iPad results
show detection only, not real WebKit behaviour.
