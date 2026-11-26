# Design

Working design notes. The visual system and screen specs are in plan §04–05;
this file records what is implemented and how the pieces fit.

## Timing core (`Domain/Timing`)

```
Meter ──┐
        ├─► ClickPattern ─┐
accents ┘                 ├─► PlaybackSegment ×N ─► PlaybackPlan ─► events(in: frames)
Tempo (bpm, beatUnit) ────┘     (role, bars?)          (immutable)        │
                                                                          ▼
                                            AudioCore scheduler (future, on Mac)
```

| Type | Responsibility |
|---|---|
| `Rational` | Exact Int64 fraction; traps on overflow |
| `NoteValue` | Note length as fraction of a whole note |
| `Meter` | N/D + additive grouping; default beat unit and grouping |
| `Tempo` | BPM (0.01 precision, 20–300) relative to an explicit beat unit |
| `ClickPattern` | Grid of `numerator × subdivision` steps; accent map per unit |
| `PlaybackSegment` | Pattern + tempo for N bars (or open-ended), role countIn/music |
| `PlaybackPlan` | Resolves segments to exact anchors; answers window, bar and change queries |
| `ClickEvent` | Frame, bar (music from 0, count-in negative), unit, sub, level, role |

### Invariants (all covered by tests)
1. Every event frame is within ½ frame of its exact time.
2. No drift with duration (checked for 60 minutes).
3. Adjacent windows `[a,b)`, `[b,c)` return each event once, in order.
4. `changing(at:)` (bar line or beat) leaves every earlier event's frame unchanged.
   Segments may start mid-bar after a tempo change; a pattern only changes at grid 0.
5. Muted units do not sound but keep their place on the grid.
6. Count-in uses the music tempo, sounds every unit, no subdivisions.

### Defaults
- Simple meters: every unit `normal`, unit 0 `downbeat`.
- Eighth-based meters: compound → groups of 3 (6/8 = 3+3); odd → 2s ending in 3
  (7/8 = 2+2+3, 5/8 = 2+3); group starts get `group`.
- Compound meters count BPM in dotted notes.

## Visual system: three concepts to compare (plan §04)

The web test switches between them live (top bar: A · Studio / B · Workshop /
C · Stage). All three run the same engine and flows; only presentation differs.
Each is defined as a token set on `:root[data-concept]` plus a few
concept-specific rules in `web/src/styles.css`.

| | A · Studio instrument | B · Analog workshop | C · Minimal stage |
|---|---|---|---|
| Palette | Graphite `#14171B`, amber `#D6A356`, lime running, blue editing | Warm charcoal `#1B1916`, ivory plates `#E6DCC3`, muted brass `#C9A46C`, olive | Near-black `#070809`, brighter amber `#E3AA52` |
| Type | System UI, rounded numerals, BPM 56–88 px | Same faces; ivory digits in a recessed display window; ivory label plates | BPM up to 280 px |
| Controls | Flat modules, chips, 56 px nudges | Bevelled hardware keys with an LED on the selected key; **tempo dial** (drag up/right, 4 px per BPM; arrows ±1, Page Up/Down ±5) | 80 px nudges, 88 px transport, setup and results behind one button |
| Beats | Rings with dots sized by accent | Indicator lamps; accent shown by bezel | Full-width blocks; the lit block moves along the bar (no full-screen flash, plan §10) |
| Navigation | Left rail (Click · Practice · Groove · Library) on wide screens | Same | None (stage) |

**D · Console** (added 2026-11-26 from the owner's reference image of a hardware
console): green LCD readout (title, meter, BPM, pattern line, transport state),
red Stop / green Start keys, tan keycaps for options with the selected key dark
and lit green, blue section labels, monospaced uppercase type, tempo knob, and a
status strip showing the last event, sample rate and clock. It adopts the
reference's visual language, not its layout or content. The reference's setlist
and layer panels belong to later features (Library, Groove) and are not built yet.

What to judge (plan): the same Quick Click flow in each; night readability and
density for B; full-screen use for C. Record the verdict in the test checklist
("4 · Design concepts").

## Sounds (`web/src/sounds.js`)

All click sounds are synthesized from recipes (tones, square waves and filtered
noise with exponential decays), rendered once per sample rate, deterministic,
and tested in Node. No recordings, so no licensing questions. Sampled
percussion and groove layers remain milestone M3.

| Kit | Character | Recipe in brief |
|---|---|---|
| Wood block (default) | Warm, hollow | 820 Hz + 2.11 kHz modes, short bandpassed noise strike |
| Tick | Mechanical metronome | Bandpassed noise at 3.8 kHz, 1.5 kHz body |
| Clave | Bright, cutting | 2.45 kHz mode, 45 ms decay |
| Rim | Cross-stick | Bandpassed noise 1.9 kHz + 470 Hz / 1.65 kHz body |
| Cowbell | Two-tone, sustains | Square 540 + 800 Hz through a 900 Hz bandpass |
| Hi-hat | Closed, sits back | Noise above 7 kHz, 20 ms |
| Beep | Pure tone | 1 kHz sine; accent a fifth up |
| Digital | Short, precise | 2 kHz square, 4 ms |

- **Levels:** downbeat 0.90, group 0.76, normal 0.62 peak; subdivisions render
  at 0.62 and go through their own **subdivision volume** (default 55%).
- **Accents:** "Pitch and volume" (default) raises the downbeat 4 semitones and
  group accents 2; "Volume only" keeps one pitch.
- **Count-in:** two **sticks** clicked together (drummer's count-off) by default,
  so it is never mistaken for bar 1; or "Same kit, lower".
- **Settings → Sound** lists the kits; picking one while stopped plays a preview
  (stick, then a bar of eighths). While playing, a change is heard from the next click.
- `node web/tools/render-kit-preview.js out.wav` renders every kit to a WAV for auditioning.
