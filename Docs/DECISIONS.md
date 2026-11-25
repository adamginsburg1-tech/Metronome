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
