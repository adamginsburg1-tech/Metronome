# Decisions

Log of decisions with the reason and what would reopen them. Newest last.
Plan references are to `POCKET_Master_Plan.pdf` section numbers.

## D-001 · Native SwiftUI + AVAudioEngine for the app (plan §06)
Adopted from the plan. Web/PWA only for throwaway UI prototypes.

## D-002 · Timing core is a platform-independent Swift package
**Decision:** The clock math lives in `PocketDomain` (no Apple frameworks) at the
repo root `Package.swift`. The Xcode app will depend on it as a local package.
**Why:** Lets the most critical code be built and tested anywhere, including
Linux CI and cloud sessions without Xcode. Matches §09 `Domain/ (models, timing math)`.
**Reopen if:** A SwiftData model needs to live in the same module.

## D-003 · Exact rational time, rounded once per event
**Decision:** Positions are `Rational` (Int64) fractions of a whole note. An
event's frame is `round(anchor + k × step)` with `step` = exact frames per grid
step. Never accumulate rounded intervals.
**Why:** §06 "calculate absolute frames rather than repeatedly rounding
intervals". Tests show adding a rounded interval drifts >100 frames in an hour
of septuplets at 113.37 BPM; the plan stays within ½ frame.
Arithmetic traps on overflow instead of producing a wrong time.

## D-004 · Segment boundaries quantized to 2⁻²⁰ frame
**Decision:** Each segment's start is stored as whole frames + a fraction
rounded to 1/1,048,576 frame.
**Why:** Exact sums of many tempos with prime BPMs overflow Int64 after a few
dozen changes (observed in testing). The quantization error is ≈20 ps per
boundary at 48 kHz, i.e. inaudible even after thousands of changes.

## D-005 · Meter unit grid; accents per unit; subdivision per unit
**Decision:** The click grid is `numerator × subdivision` equal steps per bar.
Subdivision divides the *meter unit* (denominator note). Accents are a per-unit
map (`downbeat`, `group`, `normal`, `muted`) independent of subdivision.
BPM refers to an explicit `beatUnit` (default: dotted note for compound meters).
**Why:** §07 timing semantics. Handles 7/8 (2+2+3), 6/8 in two (mute non-group
units), tuplets 2–8, without special cases.
**Reopen if:** Swing or per-beat (rather than per-unit) subdivision in odd
meters proves more natural in practice.

## D-006 · Tempo stored to 0.01 BPM; supported range 20–300
From §09 milestone 1. `Tempo(bpm: Double)` rounds to hundredths.

## D-007 · Tempo changes take effect on a bar boundary via a new plan
**Decision:** `PlaybackPlan` is immutable. A change builds a new plan with
`changing(fromBar:)`; events before that bar keep identical frames. The
TransportController (not yet built) will swap plans and bump a generation ID so
the scheduler drops stale events.
**Why:** §06 "map tempo changes to explicit beat/bar boundaries… without double triggers".

## Open (from plan §12)
- **Native tooling:** which Mac/Xcode, target iPad model and iPadOS version, and
  how personal builds get installed (free provisioning vs paid membership).
  Package currently declares iOS 17 / macOS 14 minimums — confirm.
- **Visual direction:** A (Studio instrument) is provisional; compare A/B/C.

## D-008 · Run a web spike before committing to native (2026-11-25)
**Decision:** Build a Quick Click web test (`web/`) and run it on the owner's
iPad before choosing web-first or native for M0–M2.
**Why:** A web app removes the "native tooling" risk (no Mac, Xcode or paid
developer account; builds don't expire after 7 days) and can be built and tested
from a cloud session. Known web weaknesses on iPad Safari: audio usually stops in
the background, limited interruption/route information, no Web MIDI, storage the
browser can clear. These hit performance features (M5–M6) more than practice.
**Decide after:** the three checks in the test (30-minute steady run,
interruptions, offline from the Home Screen). If they pass, go web-first for
M0–M2 and keep native (or a Capacitor wrapper) for MIDI/stage work.

## D-009 · Web timing uses double seconds, computed absolutely
**Decision:** `web/src/timing.js` mirrors the Swift model but uses seconds as
doubles on the AudioContext clock instead of rationals and frames.
**Why:** Web Audio's API takes seconds and rounds to frames itself. Computing
`anchor + k × step` directly keeps error below 1 µs over an hour (tested), so
exact rationals add nothing here.

## D-010 · Late clicks are skipped, not played late
**Decision:** If the scheduler wakes after a click's time has passed, that click
is dropped and counted as "missed".
**Why:** A late click is a wrong click. Counting misses makes timer starvation
visible in the test instead of hiding it as jitter.

## D-011 · Keep the screen awake: Off / While playing / Always (default Always)
**Decision:** A "Keep screen awake" setting uses the Wake Lock API, and falls
back to a muted, inline, looping silent video (media from NoSleep.js, MIT) when
Wake Lock is missing or refused. If the fallback needs a user gesture, the next
tap anywhere starts it. The page shows which method is active.
**Why:** The iPad must not dim or auto-lock mid-practice. Wake Lock is not
available everywhere (older iPadOS, some embedded views), so a fallback is needed.
**Limit:** This only prevents dimming and auto-lock while the page is in
front. A web page cannot unlock the iPad or override the side button; a native
app has the same limit (`isIdleTimerDisabled`).

## D-012 · Support and compare Chrome as well as Safari
**Decision:** The web test detects the browser and engine and shows it in the
diagnostics and report, with install steps for that browser (Chrome on iPad:
Share icon in the address bar → Add to Home Screen).
**Why:** The owner wants Chrome covered. On iPad, Chrome uses Apple's WebKit
engine like every other browser, so audio behaviour should match Safari, but
features such as Wake Lock and home-screen installs can differ between
Safari and apps built on WebKit. Running the checks in both settles it.

## D-013 · Tempo changes land on the next beat; segments may start mid-bar (owner, O-1)
**Decision:** While playing, a tempo change takes effect on the next beat of the
tempo's beat unit; a setting switches to the next bar. Meter, subdivision and
accent changes always land on the next bar line.
**Engine:** Segments can now be measured in grid events and may start mid-bar
(`startGrid` is derived, not stored). A pattern may only change at grid 0; the
plan rejects anything else. New API in both cores: `firstBoundary(atOrAfter:unit:)`
/ `firstBoundaryAtOrAfter(t, unit)`, `changing(at:)` / `changingAt(pos)`,
`beatGrids`, and `grid` on each event. Earlier events still never move.

## D-014 · Pause in Quick Click (owner, O-3)
Pause silences at once and keeps bar count and elapsed time; Resume continues
from the next bar number. Stop sits beside Resume while paused.

## D-015 · Count-in modes (owner, O-4)
Every start (including Resume, default) / First start only (first Start after
opening) / Off, with a 1- or 2-bar length.

## D-016 · The click plays in silent mode (owner requirement)
**Decision:** On by default, with a setting to turn it off. Two methods together:
`navigator.audioSession.type = "playback"` where supported (Safari 16.4+), and a
looping, inaudible `<audio>` track started from the Start tap, which moves the
page into playback in browsers without that API (likely Chrome on iPad). The
track keeps playing while paused and stops on Stop.
**Trade-off:** Playback audio may pause music from other apps, which matters if
you play along to a track. The test checklist now checks both. A native app
would face the same choice (`.playback` vs `.mixWithOthers`).

## D-017 · Compare the three concepts live in the web test (M0)
**Decision:** Build concepts A, B and C (plan §04) as switchable looks on the
working Quick Click instead of static mockups, so they are judged by playing.
A adds the plan's left rail; B adds a tempo dial; C hides setup behind one
button and uses a moving beat bar instead of a full-screen flash.
**Next:** the owner picks one (checklist "4 · Design concepts"); the winner is
carried into the Practice screens. Dark-only for now by design.

## D-018 · Concept D "Console" from the owner's reference (2026-11-26)
Added as a fourth switchable concept rather than replacing A–C, so it can be
compared on the same flows. Takes the reference's visual language (LCD,
coloured transport keys, tan/green-lit keycaps, mono uppercase, knob, status
strip), not its exact layout. Setlist and sound-layer panels wait for the
Library and Groove milestones.

## D-019 · Settings sheet; keep the playing surface clean (owner, 2026-11-26)
**Decision:** Main screen: tempo, ±/TAP, beats, meter, subdivision, volume.
Everything else, including the design-concept switch and the test results,
moves to a Settings sheet with tabs Click / Look / iPad / Test. Meter and
subdivision also appear in Settings so the Stage look (which hides them) can
still change them.
**Why non-modal:** the plan's rule that Stop is always reachable. The sheet
ends above the transport bar instead of covering the whole screen.

## D-020 · Practice ladder as one plan, stages rounded to whole bars (M2)
**Decision:** The interval ladder compiles to a single PlaybackPlan (count-in,
play, then silent rest + 1-bar count-in at the next tempo, play, …). Stage and
rest lengths round to whole bars. Repeat/Step down splice a new tail in at the
next rest; the head is reused unchanged, so no earlier click moves. Pause →
Resume restarts the current stage with a count-in. Sessions are stored on this
device (localStorage) until the persistence layer exists (plan §08).
**Why whole bars:** every stage starts on a downbeat, which matters more for
footwork than exact 30.0 s stages.
**JS core:** adds `segmentSpan(i)` / `segmentCount` (not yet in Swift; the native
app will need the same when Practice is ported).

## D-021 · Synthesized click kits now, samples in M3 (2026-11-26)
Eight synthesized kits with level-specific voices, a sticks count-in, accent
style and a separate subdivision volume, plus a Sound tab with previews. Chosen
over recordings for now: no licensing, no download, deterministic and testable.
Owner auditions and picks; recorded percussion and groove layers stay in M3.

## D-022 · Keep-awake runs both methods on iPad; sounds v2 (owner feedback, 2026-11-26)
**Screen slept in Chrome on iPad.** Chrome there is WebKit and can report a wake
lock that doesn't hold. On WebKit the Wake Lock and the silent inline video now
run together; the video sits on screen (4 px, nearly transparent) so iPadOS
doesn't pause it as invisible; a watchdog (5 s) and a pause listener restart
whichever drops; a refused lock is retried after a tap or a return to the page.
**Sounds not great.** Rebuilt the synthesis (band-limited waves, struck-object
envelopes, metallic hat, room, loudness matching). If v2 still isn't right,
next options: tune by ear from the owner's notes, import your own recorded
sounds, or licensed samples (M3).

## D-023 · Sample engine with a CC0 starter set (owner, 2026-11-26)
**Decision:** Recorded kits are the default. Source: VCSL (CC0), seven kits,
processed by a committed tool so onsets, lengths and loudness are consistent.
Synthesized Tick, Beep and Digital stay; synthesized versions of instruments
we now have recordings for are removed. Samples are inlined into the page so
offline use keeps working.
**Next:** owner auditions; replace or add kits with the owner's own recordings
through the same tool (`manifest.json` → `build-samples.mjs`); an on-device
importer can follow.

## D-024 · Immediate tempo and accent changes; sample mapping fixes (owner, 2026-11-26)
**Owner:** "Tapping a beat to change the pattern should happen immediately. Same
with tempo changes." Also heard accents on the wood block where there shouldn't be any.
**Changes:**
- Tempo changes default to **Immediately** (next unscheduled click, ≤ ~150 ms);
  Next beat / Next bar remain. Stored "beat" (the old default) migrates once.
- Accent changes land on the next click, mid-bar if needed. Both cores now allow
  a pattern change mid-bar when meter and subdivision are unchanged
  (`sameGrid` / `hasSameGrid`), and add a "step" boundary (`ChangeBoundary.step`).
  Meter/subdivision changes still wait for the bar line.
- **Wood block:** the normal level rotated `wood_click_mp` with `wood_click2_mp`,
  a different, much brighter block (pitch 1375 vs 2870 Hz), so every other beat
  sounded accented. Normal now uses one take.
- **Log drum:** VCSL's "Hi" files measure lower (≈155 Hz) than "Lo" (≈185 Hz);
  accents now get the higher tongue.
- New test: takes rotated within a level must match in brightness.

## D-025 · POCKET's own tempo keypad (owner, 2026-11-26)
Owner: Quick Click should open a number-only keyboard. iPadOS shows the full
keyboard (numbers layout) even for `inputmode="decimal"`, so tapping the tempo
now opens an in-app pad (0–9, ".", delete, Cancel, Set) anchored under the
number, styled per concept. Up to 5 digits and 2 decimals; 20–300 validated.
Hardware keys supported. The text field is removed.

## D-026 · HIG pass, presets, number pad everywhere (owner, 2026-11-26)
- **HIG review** (`Docs/HIG_REVIEW.md`): 44 px workspace switch; D note contrast;
  system interruptions now **pause** instead of stop (headphones, calls, other
  apps, background), keeping bar and practice stage; hardware arrow keys for
  tempo (Shift for 5); confirmations for saves.
- **Presets:** named Quick Click setups stored on the device; Save as new vs
  Update kept separate; two-tap delete; three starter presets.
- **Number pad** generalized (range, decimals, unit) and used for the Practice
  setup values as well as the tempo.

## D-027 · Gap click in the timing core (2026-11-26)
Gaps are a property of the plan (`gaps` option / `GapPattern`), not of the
pattern: `cycle(play, mute)` or `random(percent, seed, warmUp 2, maxInARow 2)`.
Gap decisions are per music bar, so timing never changes and `withGaps` can swap
them mid-run. The random function is a 32-bit hash implemented identically in
JS and Swift; both test suites check the same 64-bar sequence for seed 12345 at 30%.
Gap clicks are still returned (flagged) for the beat lights when asked, so the
lights can stay on or go dark.

## D-028 · Practice routine library (2026-11-26)
Routines replace the single ladder: kinds `ladder` and `subdivisions`, each with
its own meter, accents, subdivision(s), gap click and timings; stages are
`{bpm, sub}`. Five starter routines from plan §07 (the drum-set independence one
uses a click on 2 and 4 until grooves exist). Routine gap click is a small set of
choices rather than the full Click gap controls, to keep setup short. Library is
stored on the device like presets.

## D-029 · Look D (Console) is the default for now; redesign later (owner, 2026-11-27)
Owner: "Preferred look is D for now. It needs to be overhauled eventually because
it looks terrible." D becomes the default for new devices; A–C stay switchable.
A proper visual redesign of D is on the backlog; it should start from the
owner's specific complaints and reference images, not from more variants.

## D-030 · Swing on paired subdivisions, in both timing cores (2026-11-27)
Swing is a pattern property (50–75%), applied only for ÷2, ÷4 and ÷8: odd grid
points move later by (swing − 50)/50 of a step. Even grid points (beats, bar
lines, segment anchors) never move, so tempo changes, gaps and bar maths are
untouched; swing can change mid-bar like accents. JS and Swift compute the same
offsets (tests check frames/times in both). Practice routines stay straight for now.

## D-031 — Dense Command Center is the default layout; Clean is a setting
Following the owner's Master Click reference, the default screen is a dense
"Command Center": Now playing (LCD + knob), big transport keys (Stop, Play/Pause,
Prev, Next song), one-tap toggles (count-in, gap, beat-one accent, tempo lock,
panic restart), live counters (bar, beat, elapsed, config), a setlist built from
presets with Next up / After that, the click engine panel and per-preset song
notes. The earlier layout stays as **Settings → Look → Layout → Clean**. Both
layouts drive the same engine and settings; only `data-layout` changes. Tempo
lock blocks every tempo input (nudges, tap, dial, keypad, arrow keys).

## D-032 — Bundled UI font and gradient keys (console look)
The monospace face in look D read as a terminal, not an instrument. Look D now
uses Barlow Semi Condensed (SIL OFL 1.1, `web/src/fonts`), weights 500–800, inlined
as base64 by `build.mjs` so it works offline (~96 KB). Monospace stays only for
logs and test reports. Every key uses one gradient recipe (lit top edge, sheen on
the upper half, solid base that compresses on press), coloured per role: green
play, amber pause, red stop, tan choices, dark keys, green-glow "on" state.

## D-033 — Grooves: drum layers on the click's clock, per-song mixer
A groove is a short pattern on a 16th grid (two steps per eighth in /8 meters),
lanes kick, snare, hi-hat, open hat, shaker, tambourine, each step rest / ghost /
hit / accent. `PlaybackPlan.grooveEventsIn` computes hit times from the same
segments as the clicks, so grooves follow tempo changes (including mid-bar), meter
changes, gap bars (silent) and swing, and stay out of the count-in. Swing warps every
position inside a pair of click steps the same way, so groove offbeats land exactly
on swung clicks; with an unpaired click (e.g. quarters) the groove swings eighths.
13 starter grooves (4/4, 3/4, 5/4, 6/8, 7/8, 12/8); picking one sets its meter and
swing (at the bar line while playing). Edits apply from the next scheduled step;
users can save, update and delete their own grooves. Mixer: click, kick, snare,
hats, shaker, tambourine, each volume / pan / mute, through per-channel Web Audio
buses. Groove choice, edits, on/off and mix are saved with each preset (song).
Closed hat chokes a ringing open hat. Grooves are off in the Practice workspace.
Samples: VCSL (CC0); the kick is a muted concert bass drum because VCSL has no kit kick.
