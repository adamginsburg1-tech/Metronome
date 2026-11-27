# Backlog

Status: ☐ todo · ◐ in progress · ☑ done. Milestones from plan §09.

## Platform spike (decides web-first vs native)
- ☑ Web test: Quick Click with Web Audio lookahead scheduler, diagnostics,
  checklist and copyable report; preview artifact + home-screen build (`web/`)
- ◐ **Owner:** iPad checks. Chrome steady run done (8 min, 0 missed, screen stayed on); silent mode works; still to do: interruptions, Safari, offline
- ☐ Enable GitHub Pages (Settings → Pages → Source: GitHub Actions) for the
  home-screen/offline check
- ☐ Decide web-first vs native (D-008) and update this backlog

## UX (platform-neutral, while the iPad test runs)
- ☑ Quick Click UX spec: states, journeys J1–J6, message copy (`Docs/UX.md`)
- ☑ Web test uses the spec's copy, stops on return when time broke in the
  background, "Tap again" / "Next bar" / "Now" tempo feedback, 120 BPM default
- ☑ Owner decisions O-1 to O-4: next-beat tempo changes (with Next bar setting),
  Pause/Resume, count-in modes; built in the web test and both timing cores
- ☑ Beat row previews the next pattern instead of switching early
- ☑ Hold ±1 to repeat
- ☑ Non-blocking "timing hiccup" notice
- ☑ Practice routine UX and build: interval ladder with stage log (`Docs/UX.md`, D-020)

## M0 — Foundations (3–5 days)
Exit gate: real iPad emits a stable 4/4 click; design direction chosen.

- ☑ Repo structure, tracking docs, CI running domain tests on Linux
- ☑ **M0-01a** Pure timing module: rationals, meter + grouping, tempo with beat
  unit, click pattern (accents, subdivisions 1–8), immutable playback plan,
  count-in, windowed event queries, bar-boundary tempo change
- ☑ **M0-01b** Timing tests: 60/120/300 BPM, 4/4 and 7/8, tuplets, all
  meter × subdivision × tempo × sample-rate combinations, 60-minute drift,
  random lookahead windows, many tempo changes
- ☑ `pocket-timing-log` CLI to print the exact schedule as CSV
- ☐ **M0-01c** *(needs Mac)* Xcode project (`App/`) depending on this package
- ☐ **M0-01d** *(needs Mac)* `AudioCore`: AVAudioEngine graph, AVAudioSession
  setup, preloaded click buffers scheduled from `events(in:)` with a 100–200 ms
  lookahead; generation IDs; route-loss stop
- ☐ **M0-01e** *(needs Mac)* One native Start/Stop control that writes a rendered
  timing log (scheduled frame vs render-time sample time)
- ☐ **M0-01f** *(needs iPad)* Validate on an actual iPad with wired output; record
  loopback and compare onsets with `pocket-timing-log` (gate: ≥99% of
  inter-onset residuals ≤ 1 ms)
- ☑ Three Quick Click visual concepts (A Studio / B Workshop / C Stage),
  switchable live in the web test (D-017)
- ☑ **Owner:** picked D · Console for now (D-029)
- ☐ **Visual redesign of D** (owner: "looks terrible"): gather specific complaints and
  reference screenshots, then redesign tokens, type, keys and layout; check
  night readability and contrast
- ☐ Carry the chosen concept into the Practice screens

## Design references
- ☑ Apple HIG review and fixes (`Docs/HIG_REVIEW.md`)
- ☐ Mobbin (needs a paid plan) or owner screenshots for metronome / interval-timer patterns
- ☐ Check iPad text-size settings on device

## Sounds
- ☑ Eight synthesized click kits, sticks count-in, accent style, subdivision
  volume, Sound tab with previews (D-021)
- ☐ **Owner:** audition the kits (preview WAV or Settings → Sound); say which to keep or tune
- ☑ Sample engine + CC0 starter set: 7 recorded kits from VCSL, round robin,
  per-level takes, processing tool, credits (D-023)
- ☐ **Owner:** audition recorded kits; record your own instruments if wanted
- ☐ On-device importer for your own WAVs
- ☐ M3: mixer and groove layers (shaker, tambourine, kick/snare/hats) using the same engine

## M2 — Practice (started early in the web test)
- ☑ Interval ladder: setup, live stages, repeat / step down, effort and clean
  rating, summary, saved sessions on device
- ☐ **Owner:** run a real double-pedal session; check stage changes (exit gate)
- ☑ Gap click: bars cycle or seeded random, lights option, presets, both cores (D-027)
- ☑ Routine library: 5 starter routines, ladder and subdivision kinds, per-routine meter/accents/gaps, save/update/rename/delete (D-028)
- ☑ Port `segmentSpan` to the Swift core (`segmentFrames`, D-036)

## M1 — Quick Click (1–2 weeks)
- ☐ TransportController state machine: idle → preparing → count-in → playing ↔
  paused → stopped; error/interrupted require deliberate recovery
- ☐ Tempo controls −5/−1/field/+1/+5, tap tempo; "next bar" queued display
- ☐ Meter/grouping/subdivision/accent editing; sound + master volume; visual pulse
- ☑ Presets (save as new / update / rename / delete, starter presets) and
  last-used state, on device (D-026)
- ☑ Swing for paired divisions, both cores, presets (D-030)
- ☑ Dense Command Center default layout, Clean option in Settings (D-031)
- ☑ Grooves: 13 starter grooves, step editor, user grooves, per-song mixer (D-033)
- ☑ Swing steps refined to the drum-machine convention (D-034)
- ☑ Port `grooveEventsIn` to the Swift core (D-036)
- ☑ Kit kick: synthesized, Concert kept as an option (D-037)
- ☑ PDF charts per song in the web test (D-038); native: PDFKit + PencilKit markup
- ☑ MIDI control core in Swift: parser, mapping with learn/clear, debounce, channel filter, device notices (D-039)
- ☐ Native: connect Core MIDI to `MIDIRouter`, MIDI settings screen

## Later (M2+)
Interval trainer & gap click (segments + `.muted` already support this), session
log, samples/mixer/grooves, library, songs/setlists, MIDI. See plan §09.
