# Test results

Only results that were actually run are recorded here. Thresholds in the plan
are targets until evidence appears in this file.

## 2026-11-25 · Domain timing tests (Linux)

- **Environment:** Swift 6.0 (`swift:6.0-noble` Docker image), Ubuntu 24.04 x86_64, debug build
- **Command:** `swift test`
- **Result:** 28 tests, 0 failures (≈1.7 s). *Update below: 33 tests after D-013.*

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

## 2026-11-25 · Web test: UX spec behaviours (headless Chromium)

First launch shows 120 BPM; one tap on TAP shows "Tap again"; two +5 taps while
playing show "Next bar: 130 BPM", only 130 is applied at bar 2, then "Now 130 BPM";
a simulated background visit that starved the scheduler stopped playback on
return with "Click stopped: POCKET skipped 1 click while in the background…" and
status "Stopped"; no console errors.

## 2026-11-25 · Owner decisions O-1 to O-4 (D-013 to D-015)

- **Swift core** (`swift:6.0-noble`): 33 tests, 0 failures. New `BeatChangeTests`:
  beat grids per beat unit (4/4, 6/8 dotted quarter, 7/8), tempo change on the
  next beat lands mid-bar with earlier events identical and bar numbering
  intact, 6/8 next beat is the next dotted quarter, pattern change after a
  mid-bar tempo change lands on the bar line (mid-bar pattern change rejected),
  100 successive next-beat changes leave earlier events untouched.
- **JS core:** 15 tests, 0 failures (same cases).
- **Web test in headless Chromium:** defaults Every start / 1 bar / Next beat;
  +5 while playing shows "Next beat: 125 BPM" then "Now 125 BPM"; Pause shows
  Paused / Resume / Stop with bar held; Resume counts in and continues at bar 3;
  Stop from paused returns to Ready; "First start only" skips the count-in on the
  next Start; "Next bar" mode shows "Next bar: 126 BPM"; no console errors; no
  overflow at 390 px.

## 2026-11-25 · Remaining Quick Click items (headless Chromium)

- **Hold ±1:** holding +1 for 1 s went 120 → 125 (one step on press, then 8/s after
  400 ms); no steps after release; sliding off stopped repeating (128 stayed 128);
  Enter on a focused +1 still steps once.
- **Pattern preview:** switching 4/4 → 3/4 while playing kept 4 dots in the main
  row (not editable) and showed a 3-dot preview tagged "Next bar · 3/4"; an accent
  tap edited the preview; at the bar line the main row became 3 dots with that
  accent and the preview hid.
- **Timing hiccup:** blocking the page for 700 ms while visible showed "Timing
  hiccup: 2 clicks were skipped…", playback kept running, no stop banner; the
  notice was gone after 5 s.
- No console errors; no overflow at 390 px.

## 2026-11-25 · Play in silent mode (headless Chromium)

With a simulated `navigator.audioSession`: Start set it to "playback" and started
the silent track ("on (audio session + silent track)"); Pause kept both; Stop
released the track; turning the setting off set the session back to "auto".
Without the API: the silent track alone engaged ("on (silent track)"). Checklist
shows "3 · Silent mode". No console errors. Whether the click is audible with
silent mode on can only be checked on the iPad.

## 2026-11-25 · Design concepts A/B/C (headless Chromium)

Switching concepts sets the look live with playback running. A and B show the
workspace rail at 1180 px; B shows the dial; C hides rail, dial, setup and
results, and "Show setup and test results" reveals them. Dial: dragging 40 px up
went 120 → 130; Page Up added 5. No horizontal overflow at 390 px in any concept;
no console errors. Screenshots reviewed at 1180×820 and 390×844. Not yet judged
on the iPad or at night.

## 2026-11-26 · Concept D · Console (headless Chromium)

LCD shows "4/4 time", "Quarter + Eighth · wood · Count-in 1 bar" and "Playing ·
bar 1" while running, "Paused · resumes at bar 2" when paused; the status strip
shows the last event and "44.1 kHz · Web Audio clock…"; Start is green and turns
red as Stop; LCD and strip are hidden in the other concepts. No overflow at
390 px; no console errors. Screenshots reviewed at 1180×820 and 390×844.
