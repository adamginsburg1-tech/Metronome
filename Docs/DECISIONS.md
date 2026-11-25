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
