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

## 2026-11-26 · Silent mode on iPad (owner)

- **Result:** with silent mode on, the click still plays (owner: "works").
- Browser: Chrome on iPad (same session as the steady run above). Uses the
  audio-session setting plus the inaudible looping track (D-016).
- Still open: whether music from another app keeps playing alongside POCKET.

## 2026-11-26 · Owner feedback: wrong accents on wood block; changes should be immediate

- **Diagnosis (measured):** wood block normal takes 1832 Hz vs 4130 Hz brightness,
  pitch 1375 vs 2870 Hz (two different blocks rotating). Log drum "Hi" 155 Hz,
  "Lo" 185 Hz (accents were the lower note).
- **Node:** 31 tests, 0 failures. New: takes within a level match in brightness;
  normal takes not brighter than the downbeat; "step" boundary is the next grid
  point; accents can change mid-bar, meter/subdivision cannot.
- **Swift:** 35 tests, 0 failures (new `ImmediateChangeTests`).
- **Browser:** stored "beat" migrated to "Immediately"; +5 at 60 BPM ÷4 showed
  "Now 65 BPM" and landed on the next unscheduled sixteenth (step 7), not the next
  beat; an accent tap updated the beat row at once (no preview) and landed on the
  next sixteenth; a meter change still previewed and landed on bar 2; no errors.

## 2026-11-26 · Tempo keypad (headless Chromium, iPad Pro 11 landscape emulation)

Tapping the tempo opened the pad with focus on "1", showing 120 dimmed; no text
field remains (so no system keyboard); typing 1-3-2-.-5 showed 132.5 and Set
applied it; 400 kept the pad open with "Enter a tempo from 20 to 300."; Enter
from a hardware keyboard set 88; Escape kept 88; while playing, Set showed
"Now 120 BPM"; Stop worked with the pad open; tapping outside closed it; no
console errors. Screenshot reviewed. Not yet tried on the iPad.

## 2026-11-26 · HIG fixes, presets, Practice number pad (headless Chromium, iPad Pro 11 emulation)

- **Audit (all four looks):** only remaining sub-44 px controls are the two
  checkboxes inside 44 px labels; contrast warnings left are D's tan-gradient keys,
  verified by hand at 6.1–6.9:1.
- **Presets:** starter list shown with summaries; "· edited" after +5; Save as new
  suggested "125 BPM 4/4", saved with a confirmation; loading the 7/8 preset while
  playing previewed and switched at the bar line (7 beats); Update overwrote only
  the current preset; Rename; Delete needed two taps; the current preset survived
  a reload.
- **Practice pad:** Start tempo pad (no decimal key), 140 set and preview updated;
  700 s rejected ("Enter a value from 5 to 600."); no text inputs left in setup.
- **Interruptions:** a simulated output change while playing → Paused, "Click
  paused because the sound output changed…", Resume / Stop shown; Resume
  continued with a count-in.
- **Keyboard:** ↑ then Shift+↑ took 120 → 126.
- **Regression:** practice ladder, immediate changes, settings sheet and
  recorded kits (0 missed) all still pass; no console errors.

## 2026-11-26 · Gap click

- **JS core:** 34 tests, 0 failures. New: cycle gaps (count-in never silent;
  gap clicks flagged with includeGaps), random gaps reproducible from the seed,
  no 3 silent bars in a row over 5,000 bars, warm-up respected, share 20–32% at
  30%; gaps never move clicks and survive tempo changes; adjacent windows still exact.
- **Swift core:** 38 tests, 0 failures. New `GapTests`, including the identical
  64-bar random sequence as the JS core (seed 12345, 30%).
- **Random function:** uniform over 20,000 bars (each tenth ≈ 10%) for three seeds.
- **Browser (iPad Pro 11 emulation, 240 BPM = 1 s bars):** Bars mode sampled every
  250 ms: 2 s lit, 2 s "Silent bar" with lights dark, then lit again; switching
  to Random, 50% and a new pattern while playing applied at once; a preset saved
  with gaps shows "· gaps 50%"; loading an older preset turned gaps off;
  regression checks (presets, practice, immediate changes) pass; no errors.

## 2026-11-26 · Practice routine library (headless Chromium, iPad Pro 11 emulation)

- Five starter routines listed with summaries; an old single-ladder setting
  (start 140) carried into Double-pedal control.
- Four-mallet subdivisions: kind "subdivisions", Top hidden, preview "72 BPM ÷2 →
  ÷3 → ÷4 → ÷6 · about 3 min 33 s"; adding ÷5 marked it edited; saved as a new
  routine; live stage showed "120 ÷2 · Quarter + Eighth" and "Next: 120 BPM ÷3";
  Step down → "Next: 116 BPM ÷2, the rest at that tempo"; the rest asked "How did
  120 BPM ÷2 feel?"; the summary and history named the routine and stages.
- Rudiments routine shows Random 25% gaps in its preview; Independence routine
  shows plain tempos (click on 2 and 4); Delete needed two taps.
- Regression: practice ladder, gaps, presets, immediate changes, settings sheet,
  34 Node tests; no console errors; no overflow at 390 px.
- **Found and fixed during testing:** Start passed a stage object instead of its
  tempo (routine didn't start); routine cards had uneven widths.

## 2026-11-27 · Swing

- **JS core:** 37 tests, 0 failures. New: swung eighths at 60% land at 0, 0.3,
  0.5, 0.8 s (120 BPM); swung sixteenths at 0, 0.15, 0.25, 0.4 s; 67% gives 0.335 s;
  triplets ignore swing; 80% and 40% rejected; heaviest swing keeps notes in
  order; adjacent windows exact; swing changes mid-bar.
- **Swift core:** 41 tests, 0 failures. New `SwingTests` with the same values in
  frames (14 400 for the 60% off-eighth at 48 kHz) and window checks in 7/8.
- **Browser (iPad Pro 11 emulation), recording real scheduled click times:**
  Triplet swing measured 0.670 of the beat; switching to Straight while playing
  took effect at the next unscheduled eighth (times in eighths: … 5.34, 6.00, 7.00,
  8.00 …); Swing row hidden for no subdivision and triplets, shown for ÷2; Settings
  greys it out for triplets with an explanation; the console display shows
  "swing 60%"; regression checks pass; no errors.

## Command Center layout (D-031)
- **Browser (iPad Pro 11 portrait/landscape, phone width):** dense layout is the
  default; play, pause/resume, stop, prev/next song, tempo-lock toast, panic
  restart, gap/count-in/beat-one toggles and per-song notes all work; Settings →
  Layout → Clean restores the earlier screen; no horizontal overflow at any size.
- **Regression scripts** (presets, gaps, swing, immediate changes, settings sheet,
  samples, keypad, HIG checks, practice, routines) pass in the Clean layout; no errors.
- **Node:** 37 tests pass. **Swift:** 41 tests pass (core unchanged).

## Grooves (D-033)
- **Node:** 42 tests pass. Five new groove tests: 16th grid at tempo, windowed
  scheduling never repeats or skips (swung, with count-in, odd window sizes),
  count-in silent, groove offbeats equal swung click times, tempo change mid-bar and
  gap bars, eighth swing over a quarter-note click.
- **Browser (iPad landscape), real scheduled start times:** at 120 BPM drum hits
  and clicks share the 0.25 s eighth grid; playhead follows; editing a step while
  playing marks the groove edited; picking Six-eight switches the meter to 6/8 at the
  bar line; kick mute, groove choice and on/off survive reload; groove panel shows in
  Clean too; no overflow at phone width; all regression scripts pass; no errors.

## Swing steps (D-034)
- **Browser:** Triplet (67%) measured 0.670 of the beat offbeat; Relaxed (58%)
  shows in the console line and the preset line; swing hidden for triplets in
  Settings with the explanatory note; the regression scripts pass with no errors.
- **Node:** 42 tests pass.

## Groove swing rule (D-035)
- **Node:** 44 tests pass. New: a sixteenth groove swings sixteenths under a
  quarter-note click (times 0, 0.165, 0.25, 0.415 s at 120 BPM, swing 66); an eighth
  groove swings eighths under a sixteenth-note click (0, 0.33 s).
- **Shares measured for every click (÷1, ÷2, ÷3, ÷4) at 67%:** eighth and sixteenth
  grooves both give 0.670 for the swung pair.
- **Browser regressions** (groove, swing, cc, presets, hig-check): no errors.

## Bug found in the browser: eighth grooves stopped swinging (fixed)
- The playhead lane (`_step`, one hit per step) was counted as notes, so every groove
  paired as sixteenths and eighths stayed straight. Node tests missed it because they
  don't include the playhead lane. Fixed: the playhead is ignored when choosing pairs;
  a Node test now includes it.
- **Browser, groove Rock eighths at 120 BPM:** swing 67 hi-hats at 0, 335, 500, 835 ms;
  swing 50 at 0, 250, 500, 750 ms. Sixteenth groove at 67: 0, 167.5, 250, 417.5 ms.
- **Node:** 45 tests pass.

## Swift groove port (D-036)
- **Swift:** 51 tests, 0 failures. New `GrooveTests` (10): 16th grid at tempo,
  windowed queries never repeat or skip, count-in silent and offbeats on swung clicks,
  mid-bar tempo change and gap bars, eighth/sixteenth swing under each click, playhead
  lane ignored, pairs restart each bar in 7/8, segment frames.
- **Node:** 46 tests pass; the 7/8 case gives the same frames as Swift.

## Kit kick (D-037)
- **Small-speaker check (150 Hz high-pass, first 30 ms RMS / full):** kit accent 0.52,
  normal 0.43, ghost 0.31; concert normal 0.53; snare 0.99.
- **Browser:** Kit is the default and the kick lane plays the synthesized buffers;
  choosing Concert switches to the recorded ones; the choice persists; groove, cc,
  presets, hig-check and swing timing checks pass with no errors.

## PDF charts (D-038)
- **Browser (iPad landscape):** pdf.js not loaded at start-up; a 3-page PDF added to
  a song shows "Page 1 of 3"; Page ›, Page Down and a left-side tap turn pages; Next
  is disabled on the last page; ↑ still changes tempo; another song shows "No chart";
  returning shows the page left on; the chart survives reload (IndexedDB); a non-PDF
  file is refused with a message; Remove needs two taps; no overflow at phone width.
- **All regression scripts** pass with no errors; **Node** 46 tests pass.
- Not verified: whether the claude.ai artifact host allows worker threads (the
  main-thread fallback covers it) and real iPad page-turner pedals.

## MIDI core (D-039)
- **Swift:** 58 tests, 0 failures, no build warnings. New `MIDITests` (7): parser
  (running status, real-time interleaved, SysEx, packet boundaries), learn/rebind/
  clear, CC press once until release, debounce and channel filter, mapping
  save/load, device connect/disconnect messages.

## Transport controller (D-040)
- **Swift:** 79 tests, 0 failures, no build warnings. New `TransportTests` (21):
  count-in then playing with exact frames; chunked scheduling never repeats or
  skips; pause/resume continues from the next bar and keeps elapsed time without
  pauses or count-ins; first-start-only and off count-ins; stop resets; tempo
  change lands on the next unscheduled click, combines, never moves scheduled
  clicks, then shows as landed for one bar; next-bar tempo; meter change on the
  bar line and accent change mid-bar; pattern change during count-in; interruptions
  pause with the message and are ignored while paused; failed start and failed
  resume; stopped-by-system recovery; skipped clicks on screen vs background;
  tempo nudge clamping; pedal actions; tap tempo averaging, reset and clamping.
- Not yet run on a device: needs the native app (Mac + Xcode).
