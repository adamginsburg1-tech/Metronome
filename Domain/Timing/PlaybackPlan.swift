/// Why a segment exists. The audio layer can give count-ins their own sound.
public enum SegmentRole: String, Sendable, Hashable {
    case countIn
    case music
}

/// A run of grid events with one pattern and one constant tempo.
///
/// Give a length in whole `bars` or in grid `events`; leave both nil for
/// "until stopped" (last segment only). A segment may start mid-bar (after a
/// tempo change on a beat) and then continues the bar it starts in. A
/// *pattern* may only change on a bar line.
public struct PlaybackSegment: Sendable, Hashable {
    public var pattern: ClickPattern
    public var tempo: Tempo
    public var bars: Int?
    public var events: Int?
    public var role: SegmentRole

    public init(pattern: ClickPattern, tempo: Tempo, bars: Int? = nil, events: Int? = nil, role: SegmentRole = .music) {
        self.pattern = pattern
        self.tempo = tempo
        self.bars = bars
        self.events = events
        self.role = role
    }
}

/// A grid position: bar number plus grid step within the bar (0 = downbeat).
public struct BarPosition: Sendable, Hashable, CustomStringConvertible {
    public var bar: Int
    public var grid: Int

    public init(bar: Int, grid: Int = 0) {
        self.bar = bar
        self.grid = grid
    }

    public var description: String { "bar \(bar) step \(grid)" }
}

/// Where a change made while playing takes effect.
public enum ChangeBoundary: String, Sendable, Hashable {
    /// The very next grid point: the change lands immediately (default for tempo
    /// and accent changes).
    case step
    /// Next beat of the tempo's beat unit.
    case beat
    /// Next bar line (always used for meter, subdivision and accent changes).
    case bar
}

/// One scheduled click.
public struct ClickEvent: Sendable, Hashable, CustomStringConvertible {
    /// Absolute sample frame on the plan's timeline.
    public let frame: Int64
    /// Bar number. Music starts at bar 0; count-in bars are negative.
    public let bar: Int
    /// Meter unit within the bar (0-based).
    public let unit: Int
    /// Subdivision within the unit (0 = on the unit).
    public let subdivision: Int
    /// Grid step within the bar (`unit × subdivisions + subdivision`).
    public let grid: Int
    public let level: AccentLevel
    public let role: SegmentRole
    public let segmentIndex: Int

    public var position: BarPosition { BarPosition(bar: bar, grid: grid) }

    public var description: String {
        "frame \(frame) bar \(bar) unit \(unit).\(subdivision) \(level) \(role)"
    }
}

extension ClickPattern {
    /// Same meter and subdivision (accents may differ): the bar's grid is unchanged.
    public func hasSameGrid(as other: ClickPattern) -> Bool {
        meter.numerator == other.meter.numerator && meter.denominator == other.meter.denominator && subdivision == other.subdivision
    }

    /// Grid steps in a bar that fall on a beat of `beatUnit` (always includes 0).
    public func beatGrids(beatUnit: NoteValue) -> [Int] {
        (0..<meter.numerator).compactMap { unit in
            let ratio = meter.unit.wholeNotes * Rational(unit) / beatUnit.wholeNotes
            return ratio.isInteger ? unit * subdivision : nil
        }
    }
}

/// An immutable, fully resolved schedule.
///
/// The plan is the single source of truth for *when* clicks happen. Every
/// event frame is computed directly from exact rational time
/// (`anchor + k × step`) and rounded once, so error never accumulates no
/// matter how long playback runs. The audio scheduler asks for events in a
/// bounded lookahead window with `events(in:)`; consecutive windows return
/// each event exactly once.
///
/// Changes made while playing produce a *new* plan with `changing(at:_:)`,
/// which keeps every event before that position identical.
public struct PlaybackPlan: Sendable {
    /// Fraction-of-a-frame resolution kept at segment boundaries
    /// (2⁻²⁰ frame ≈ 20 picoseconds at 48 kHz). Bounding it keeps the
    /// integer math from overflowing across many tempo changes.
    static let anchorResolution: Int64 = 1 << 20

    public let sampleRate: Int
    public let startFrame: Int64
    /// Segments normalized to event counts (`bars` is always nil here).
    public let segments: [PlaybackSegment]

    private let resolved: [ResolvedSegment]

    public init(sampleRate: Int, segments: [PlaybackSegment], startFrame: Int64 = 0) throws {
        guard (8_000...384_000).contains(sampleRate) else {
            throw TimingError.invalidSampleRate(sampleRate)
        }
        guard !segments.isEmpty else {
            throw TimingError.invalidPlan("a plan needs at least one segment")
        }

        var normalized: [PlaybackSegment] = []
        var pending: [(segment: PlaybackSegment, anchor: TimelinePoint, step: Rational, barIndex: Int, startGrid: Int)] = []
        var anchor = TimelinePoint(whole: startFrame, fraction: .zero)
        var grid = 0
        var barsSoFar = 0
        var previousPattern: ClickPattern?

        for (index, input) in segments.enumerated() {
            let perBar = input.pattern.eventsPerBar
            var events = input.events
            if events == nil, let bars = input.bars {
                guard bars > 0 else { throw TimingError.invalidPlan("segment \(index) must have at least one bar") }
                guard grid == 0 else { throw TimingError.invalidPlan("segment \(index) gives whole bars but starts mid-bar") }
                events = bars * perBar
            }
            if let events, events <= 0 {
                throw TimingError.invalidPlan("segment \(index) must have at least one event")
            }
            if events == nil && index != segments.count - 1 {
                throw TimingError.invalidPlan("only the last segment may be open-ended")
            }
            // Mid-bar only the accents may change; meter and subdivision define the bar's grid.
            if grid != 0, let previous = previousPattern, !input.pattern.hasSameGrid(as: previous) {
                throw TimingError.invalidPlan("segment \(index) changes meter or subdivision mid-bar")
            }

            let segment = PlaybackSegment(pattern: input.pattern, tempo: input.tempo, events: events, role: input.role)
            normalized.append(segment)
            let step = input.tempo.framesPerWholeNote(sampleRate: sampleRate) * input.pattern.stepLength
            pending.append((segment, anchor, step, barsSoFar, grid))
            if let events {
                anchor = (anchor + Rational(Int64(events)) * step).quantized(to: PlaybackPlan.anchorResolution)
                let g = grid + events
                barsSoFar += g / perBar
                grid = g % perBar
            }
            previousPattern = input.pattern
        }

        // Music starts at bar 0; count-in bars are negative.
        let countInBars = pending.first { $0.segment.role != .countIn }?.barIndex ?? 0
        self.resolved = pending.map {
            ResolvedSegment(
                segment: $0.segment, anchor: $0.anchor, step: $0.step,
                eventCount: $0.segment.events.map(Int64.init),
                firstBar: $0.barIndex - countInBars, startGrid: $0.startGrid
            )
        }
        self.sampleRate = sampleRate
        self.startFrame = startFrame
        self.segments = normalized
    }

    /// Standard metronome: optional count-in bars (units only), then the pattern until stopped.
    public static func click(
        pattern: ClickPattern,
        tempo: Tempo,
        countInBars: Int = 0,
        sampleRate: Int,
        startFrame: Int64 = 0
    ) throws -> PlaybackPlan {
        var segments: [PlaybackSegment] = []
        if countInBars > 0 {
            let audible = pattern.accents.map { $0 == .muted ? AccentLevel.normal : $0 }
            let countIn = try ClickPattern(meter: pattern.meter, subdivision: 1, accents: audible)
            segments.append(PlaybackSegment(pattern: countIn, tempo: tempo, bars: countInBars, role: .countIn))
        }
        segments.append(PlaybackSegment(pattern: pattern, tempo: tempo))
        return try PlaybackPlan(sampleRate: sampleRate, segments: segments, startFrame: startFrame)
    }

    // MARK: Queries

    /// Frame after the last event, or nil if the plan runs until stopped.
    public var endFrame: Int64? {
        guard let last = resolved.last, let count = last.eventCount else { return nil }
        return last.exactPoint(ofEvent: count).roundedHalfUp
    }

    /// All audible events with `frames.lowerBound <= frame < frames.upperBound`, in order.
    /// Querying adjacent windows never repeats or skips an event.
    public func events(in frames: Range<Int64>) -> [ClickEvent] {
        var result: [ClickEvent] = []
        forEachGridPoint(in: frames) { segmentIndex, k, frame in
            let item = resolved[segmentIndex]
            let pattern = item.segment.pattern
            let perBar = Int64(pattern.eventsPerBar)
            let g = Int64(item.startGrid) + k
            let gridIndex = Int(g % perBar)
            let level = pattern.level(atGridIndex: gridIndex)
            guard level != .muted else { return }
            result.append(ClickEvent(
                frame: frame,
                bar: item.firstBar + Int(g / perBar),
                unit: gridIndex / pattern.subdivision,
                subdivision: gridIndex % pattern.subdivision,
                grid: gridIndex,
                level: level,
                role: item.segment.role,
                segmentIndex: segmentIndex
            ))
        }
        return result
    }

    /// Frame of a grid position, or nil if it is outside the plan.
    public func startFrame(of position: BarPosition) -> Int64? {
        guard let (index, k) = locate(position) else { return nil }
        return resolved[index].frame(ofEvent: k)
    }

    /// Frame on which `bar` begins, or nil if the bar is outside the plan.
    public func startFrame(ofBar bar: Int) -> Int64? {
        startFrame(of: BarPosition(bar: bar))
    }

    /// The first beat or bar line at or after `frame` — where a change queued
    /// now should land. Beats follow each segment's tempo beat unit.
    public func firstBoundary(atOrAfter frame: Int64, unit: ChangeBoundary) -> BarPosition? {
        for item in resolved {
            let pattern = item.segment.pattern
            let perBar = Int64(pattern.eventsPerBar)
            let allowed: Set<Int>? = switch unit {
            case .step: nil
            case .beat: Set(pattern.beatGrids(beatUnit: item.segment.tempo.beatUnit))
            case .bar: [0]
            }
            var k = item.firstEvent(atOrAfter: frame)
            while item.eventCount.map({ k < $0 }) ?? true {
                let g = Int64(item.startGrid) + k
                let gridIndex = Int(g % perBar)
                if allowed?.contains(gridIndex) ?? true {
                    return BarPosition(bar: item.firstBar + Int(g / perBar), grid: gridIndex)
                }
                k += 1
            }
        }
        return nil
    }

    /// The first bar that starts at or after `frame`.
    public func firstBar(startingAtOrAfter frame: Int64) -> Int? {
        firstBoundary(atOrAfter: frame, unit: .bar)?.bar
    }

    /// A new plan identical up to (not including) `position`, with `transform`
    /// applied to every segment from there on. Earlier events keep exactly the
    /// same frames, so the switch is seamless. A transform that changes the
    /// pattern must use a bar line (grid 0).
    public func changing(at position: BarPosition, _ transform: (inout PlaybackSegment) throws -> Void) throws -> PlaybackPlan {
        guard let (index, k) = locate(position) else {
            throw TimingError.invalidPlan("\(position) is outside the plan")
        }
        var newSegments = Array(segments[..<index])
        var tail = Array(segments[index...])
        if k > 0 {
            var head = tail[0]
            head.events = Int(k)
            newSegments.append(head)
            if let events = tail[0].events { tail[0].events = events - Int(k) }
        }
        for i in tail.indices {
            try transform(&tail[i])
            tail[i].bars = nil
        }
        return try PlaybackPlan(sampleRate: sampleRate, segments: newSegments + tail, startFrame: startFrame)
    }

    /// Same as `changing(at:)` on a bar line.
    public func changing(fromBar bar: Int, _ transform: (inout PlaybackSegment) throws -> Void) throws -> PlaybackPlan {
        try changing(at: BarPosition(bar: bar), transform)
    }

    /// Switch tempo starting at `position` (a beat or a bar line).
    public func changingTempo(to tempo: Tempo, at position: BarPosition) throws -> PlaybackPlan {
        try changing(at: position) { $0.tempo = tempo }
    }

    /// Switch tempo starting at `bar`.
    public func changingTempo(to tempo: Tempo, fromBar bar: Int) throws -> PlaybackPlan {
        try changingTempo(to: tempo, at: BarPosition(bar: bar))
    }

    // MARK: Internals

    private func locate(_ position: BarPosition) -> (Int, Int64)? {
        for (index, item) in resolved.enumerated() {
            let perBar = Int64(item.segment.pattern.eventsPerBar)
            let k = Int64(position.bar - item.firstBar) * perBar + Int64(position.grid - item.startGrid)
            if k >= 0, item.eventCount.map({ k < $0 }) ?? true {
                return (index, k)
            }
        }
        return nil
    }

    /// Visits every grid point (audible or muted) in the window, in order.
    private func forEachGridPoint(in frames: Range<Int64>, _ body: (Int, Int64, Int64) -> Void) {
        guard !frames.isEmpty else { return }
        for (segmentIndex, item) in resolved.enumerated() {
            if let count = item.eventCount, item.frame(ofEvent: count) <= frames.lowerBound { continue }
            if item.frame(ofEvent: 0) >= frames.upperBound { break }

            var k = item.firstEvent(atOrAfter: frames.lowerBound)
            while item.eventCount.map({ k < $0 }) ?? true {
                let frame = item.frame(ofEvent: k)
                if frame >= frames.upperBound { return }
                body(segmentIndex, k, frame)
                k += 1
            }
        }
    }
}

// MARK: - Exact timeline arithmetic

/// A point on the timeline split into whole frames and a fraction in [0, 1),
/// so large frame counts and fine fractions never share one Int64.
struct TimelinePoint: Sendable, Hashable {
    var whole: Int64
    var fraction: Rational

    static func + (point: TimelinePoint, offset: Rational) -> TimelinePoint {
        let offsetWhole = offset.floor
        let sum = point.fraction + (offset - Rational(offsetWhole))
        let carry = sum.floor
        return TimelinePoint(whole: point.whole + offsetWhole + carry, fraction: sum - Rational(carry))
    }

    var roundedHalfUp: Int64 { whole + (fraction < .half ? 0 : 1) }

    var doubleValue: Double { Double(whole) + fraction.doubleValue }

    func quantized(to resolution: Int64) -> TimelinePoint {
        let ticks = (fraction * Rational(resolution)).roundedHalfUp
        return TimelinePoint(whole: whole, fraction: .zero) + Rational(ticks, resolution)
    }
}

private struct ResolvedSegment: Sendable {
    let segment: PlaybackSegment
    let anchor: TimelinePoint
    /// Exact frames between grid events.
    let step: Rational
    let eventCount: Int64?
    let firstBar: Int
    /// Grid step within its first bar at which this segment starts.
    let startGrid: Int

    func exactPoint(ofEvent k: Int64) -> TimelinePoint {
        anchor + Rational(k) * step
    }

    func frame(ofEvent k: Int64) -> Int64 {
        exactPoint(ofEvent: k).roundedHalfUp
    }

    /// First event index whose frame is >= `frame` (may equal `eventCount`).
    func firstEvent(atOrAfter target: Int64) -> Int64 {
        let guess = ((Double(target) - anchor.doubleValue) / step.doubleValue).rounded(.down)
        var k: Int64 = (guess.isFinite && guess > 1) ? Int64(min(guess, 9.0e15)) - 1 : 0
        if let count = eventCount { k = min(k, count) }
        while k > 0 && frame(ofEvent: k - 1) >= target { k -= 1 }
        while (eventCount.map { k < $0 } ?? true) && frame(ofEvent: k) < target { k += 1 }
        return k
    }
}
