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

## Visual system
Not started. Tokens from plan §04 (provisional direction A): canvas `#14171B`,
surface `#272C33`, text `#E9E6DD`, muted `#A9B2BC`, accent amber `#D6A356`,
active lime `#A6D66C`, info blue `#82B8D5`, danger `#FF7777`.
