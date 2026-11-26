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

## 2026-11-26 · Settings sheet (headless Chromium)

Main screen shows only Meter, Subdivision and Master volume beside the tempo.
Settings opens with focus on its title; count-in change applied; Look tab
switched to D live; **Stop worked with the sheet open**; Test tab shows the
counters; Esc closed it and returned focus to the Settings button; it reopened
on the last tab; the backdrop closes it; a meter picked in the sheet updates the
main screen; Stage hides the quick panel. No overflow at 390 px; no console
errors. Screenshots reviewed at 1180×820 and 390×844.

## 2026-11-26 · Practice ladder (Node + headless Chromium)

- **JS core:** 16 tests, 0 failures. New: segment spans tile the timeline for a
  ladder (count-in, play, silent rest, count-in, play); the rest produces no clicks.
- **Browser run 1** (120 → 180 by 20, 5 s / 4 s): defaults shown as 130 / 5 /
  160 / 30 / 15 with "7 stages … about 5 min 02 s"; step 60 clamped to 20;
  workspace switch locked while playing; Repeat during stage 1 inserted 120
  again; phases ran Count-in → Play → Count-in → Play (repeat) → Play 140 → Rest
  …; the ladder ended by itself ("Ladder complete"); the session saved with notes
  and appeared in Recent sessions.
- **Browser run 2** (200 → 240 by 20, 5 s / 5 s): Step down set the next stage to
  180; during the rest the screen showed "Rest · 180 · Coming up: 180 BPM" and
  "How did 200 feel?"; effort 4 and clean were recorded and carried into the
  summary ("1 | 200 | Yes | 4 | true", "2 | 180 | Stopped | – | false"); clean
  working tempo proposed 200; Discard needed two taps; Pause → Resume restarted
  the stage with a count-in.
- No console errors; no overflow at 390 px. Not yet run with real playing.

## 2026-11-26 · Click kits (Node + headless Chromium)

- **Node:** 22 tests, 0 failures. Sounds (6 new): every kit × voice × option at
  44.1 and 48 kHz is finite, 20–500 ms long, starts without a jump, ends at
  silence and hits its target peak; accents louder than normal; "pitch" accents
  raise pitch and "level" keeps it; count-in differs from bar 1; rendering is
  deterministic.
- **Browser:** Sound tab lists 8 kits (default Wood block / Pitch and volume /
  Sticks); every kit previewed; accent style and count-in sound switch; kit
  swap and subdivision volume change while playing with 0 missed clicks; LCD
  shows the kit name; no console errors; no overflow at 390 px.
- **Listening:** a WAV of all kits was rendered for the owner. Not yet judged by ear.

## 2026-11-26 · Owner feedback fixes: Chrome keep-awake, sounds v2

- **Owner report (iPad, Chrome):** screen went to sleep; sounds "not great".
- **Keep-awake (headless Chromium posing as Chrome on iPad):** with Wake Lock
  granted, status "Wake Lock + silent video"; with it refused, "silent video";
  video measured 4×4 px on screen; pausing the video on purpose was recovered
  automatically; no console errors. **Needs confirming on the iPad.**
- **Sounds v2 (Node):** 24 tests, 0 failures. New: kits within 1.6× loudness
  of each other; cowbell, digital, rim and beep keep < 2% energy above 18 kHz
  (no aliasing). All voices finite, click-free, under the 0.95 peak cap, on
  their loudness target; accents louder; count-in distinct.
- **Browser:** kit swap and subdivision volume while playing, 0 missed clicks;
  no console errors. A v2 preview WAV was sent to the owner.

## 2026-11-26 · Sample engine and CC0 starter set

- **Processing:** 38 takes across 7 kits; every attack within 0.45 ms of the
  file start (tool report); 1.2 MB total.
- **Node:** 27 tests, 0 failures. New `samples.test.js`: the set is the CC0 VCSL
  library with the expected 7 kits; every take starts on its attack (< 1 ms),
  ends at silence, is ≤ 0.5 s; built kits keep peaks ≤ 0.95, accents louder than
  normal in both accent styles, count-in present for both count-in options;
  "Louder only" reuses the normal takes.
- **Browser (headless Chromium):** page 1.6 MB loads in ~0.2 s locally; Sound tab
  lists 7 recorded + 3 synthesized kits with Wood block (recorded) as default;
  every kit previews; Start → running in 32 ms; switching through all 7 recorded
  kits while playing with subdivisions: 43 clicks, 0 missed; no console errors.
- **Listening:** preview WAV of all 10 kits sent to the owner; not yet judged by ear.

## 2026-11-26 · First iPad run: Chrome (owner)

- **Device:** iPad, iPadOS 26.6.1, Chrome 158 (WebKit), preview build, concept D,
  recorded Hi-hat, 120 BPM 4/4, no subdivision, 48 kHz.
- **Timing:** 8 min 02 s, 965 clicks scheduled, **0 missed**. Worst timer gap
  82 ms against a 150 ms lookahead; tightest lead 109 ms. Audio clock vs system
  clock −10.4 ppm (normal crystal difference; the audio clock is the reference,
  so this doesn't affect the click).
- **Latency reported:** base 2.7 ms, output 11.1 ms.
- **Keep-awake:** screen stayed on for the whole run. Wake Lock was refused three
  times on load ("Permission was denied", i.e. before any tap), then granted on
  the first tap; the silent video ran from load. Status at the end: Wake Lock + video.
- **Owner verdict:** "8 minutes in Chrome is good enough."
- **Not yet tried:** interruptions, silent mode, music from another app, the
  ladder, Safari, offline/home screen, concept verdicts.
- **Side note:** Chrome reports `audioSession.type` back as "auto" after audio
  stops, so POCKET sets "playback" again at each Start (seen as repeated log
  lines). Harmless; silent-mode behaviour still needs the real check.
