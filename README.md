# POCKET

*Find your time.* A personal, offline-first percussion workstation for iPad.

The full product, design and engineering plan is in
[`Docs/POCKET_Master_Plan.pdf`](Docs/POCKET_Master_Plan.pdf). Working decisions,
backlog, design notes and test evidence live next to it in `Docs/`.

## Status

Milestone 0 groundwork. The timing core is built and tested (Swift package and
a JS port). A web test (`web/`) is ready to run on the iPad to decide between
web-first and native (`Docs/DECISIONS.md` D-008). No native app exists yet.

## Layout

| Path | Contents |
|---|---|
| `Domain/` | `PocketDomain`: pure timing math (rationals, meter, tempo, click patterns, playback plan) |
| `Tests/DomainTests/` | XCTest suite for the timing core |
| `Tools/TimingLog/` | `pocket-timing-log`: prints a plan's exact click schedule as CSV |
| `web/` | Web test: Quick Click on Web Audio with diagnostics and three switchable design concepts (see `web/README.md`) |
| `Docs/` | Master plan, DECISIONS, BACKLOG, DESIGN, UX, TEST_RESULTS |

Planned, not yet created: `App/`, `DesignSystem/`, `AudioCore/`,
`Persistence/`, `Features/` (Xcode project on a Mac).

## Running

Requires Swift 5.10+ (Xcode 15.3+ on a Mac, or the official Swift toolchain / `swift:6.0` Docker image on Linux).

```sh
swift test
swift run pocket-timing-log --bpm 120 --meter 7/8 --grouping 2+2+3 --count-in 1 --seconds 10
```

Without a local toolchain:

```sh
docker run --rm -v "$PWD":/src -w /src swift:6.0-noble swift test
```

## How the clock works (short version)

A `PlaybackPlan` is an immutable list of segments (count-in, constant-tempo
runs). Every click's frame is computed directly as `anchor + k × step` in exact
rational arithmetic and rounded once, so error never accumulates. The audio
scheduler asks for `events(in: frameWindow)` over a bounded lookahead;
adjacent windows return each click exactly once. A tempo change while running
builds a new plan from the next bar with `changingTempo(to:fromBar:)`, which
leaves every earlier click identical. UI timers never drive the clock.
