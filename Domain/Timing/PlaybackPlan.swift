/// Why a segment exists. The audio layer can give count-ins their own sound.
public enum SegmentRole: String, Sendable, Hashable {
    case countIn
    case music
}

/// A run of bars with one pattern and one constant tempo.
/// `bars == nil` means "until stopped" and is only allowed for the last segment.
public struct PlaybackSegment: Sendable, Hashable {
    public var pattern: ClickPattern
    public var tempo: Tempo
    public var bars: Int?
    public var role: SegmentRole

    public init(pattern: ClickPattern, tempo: Tempo, bars: Int? = nil, role: SegmentRole = .music) {
        self.pattern = pattern
        self.tempo = tempo
        self.bars = bars
        self.role = role
    }
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
    public let level: AccentLevel
    public let role: SegmentRole
    public let segmentIndex: Int

    public var description: String {
        "frame \(frame) bar \(bar) unit \(unit).\(subdivision) \(level) \(role)"
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
/// Tempo or pattern changes produce a *new* plan with `changing(fromBar:_:)`,
/// which keeps every event before that bar identical.
public struct PlaybackPlan: Sendable {
    /// Fraction-of-a-frame resolution kept at segment boundaries
    /// (2⁻²⁰ frame ≈ 20 picoseconds at 48 kHz). Bounding it keeps the
    /// integer math from overflowing across many tempo changes.
    static let anchorResolution: Int64 = 1 << 20

    public let sampleRate: Int
    public let startFrame: Int64
    public let segments: [PlaybackSegment]

    private let resolved: [ResolvedSegment]

    public init(sampleRate: Int, segments: [PlaybackSegment], startFrame: Int64 = 0) throws {
        guard (8_000...384_000).contains(sampleRate) else {
            throw TimingError.invalidSampleRate(sampleRate)
        }
        guard !segments.isEmpty else {
            throw TimingError.invalidPlan("a plan needs at least one segment")
        }
        for (index, segment) in segments.enumerated() {
            if let bars = segment.bars, bars <= 0 {
                throw TimingError.invalidPlan("segment \(index) must have at least one bar")
            }
            if segment.bars == nil && index != segments.count - 1 {
                throw TimingError.invalidPlan("only the last segment may be open-ended")
            }
        }

        let countInBars = segments.prefix { $0.role == .countIn }.reduce(0) { $0 + ($1.bars ?? 0) }

        var resolved: [ResolvedSegment] = []
        var anchor = TimelinePoint(whole: startFrame, fraction: .zero)
        var firstBar = -countInBars
        for segment in segments {
            let step = segment.tempo.framesPerWholeNote(sampleRate: sampleRate) * segment.pattern.stepLength
            let eventCount = segment.bars.map { Int64($0 * segment.pattern.eventsPerBar) }
            let item = ResolvedSegment(segment: segment, anchor: anchor, step: step, eventCount: eventCount, firstBar: firstBar)
            resolved.append(item)
            if let count = eventCount, let bars = segment.bars {
                anchor = item.exactPoint(ofEvent: count).quantized(to: PlaybackPlan.anchorResolution)
                firstBar += bars
            }
        }

        self.sampleRate = sampleRate
        self.startFrame = startFrame
        self.segments = segments
        self.resolved = resolved
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
            let gridIndex = Int(k % perBar)
            let level = pattern.level(atGridIndex: gridIndex)
            guard level != .muted else { return }
            result.append(ClickEvent(
                frame: frame,
                bar: item.firstBar + Int(k / perBar),
                unit: gridIndex / pattern.subdivision,
                subdivision: gridIndex % pattern.subdivision,
                level: level,
                role: item.segment.role,
                segmentIndex: segmentIndex
            ))
        }
        return result
    }

    /// Frame on which `bar` begins, or nil if the bar is outside the plan.
    public func startFrame(ofBar bar: Int) -> Int64? {
        guard let index = segmentIndex(containingBar: bar) else { return nil }
        let item = resolved[index]
        let k = Int64(bar - item.firstBar) * Int64(item.segment.pattern.eventsPerBar)
        return item.exactPoint(ofEvent: k).roundedHalfUp
    }

    /// The first bar that starts at or after `frame` (use it to queue a change
    /// "on the next bar"). Nil if no bar starts there.
    public func firstBar(startingAtOrAfter frame: Int64) -> Int? {
        for item in resolved {
            let barStep = item.step * Rational(item.segment.pattern.eventsPerBar)
            let bars = item.segment.bars.map(Int64.init)
            var b = max(0, Int64(((Double(frame) - item.anchor.doubleValue) / barStep.doubleValue).rounded(.down)) - 1)
            if let bars, b >= bars { continue }
            func start(_ bar: Int64) -> Int64 { item.exactPoint(ofEvent: bar * Int64(item.segment.pattern.eventsPerBar)).roundedHalfUp }
            while b > 0 && start(b - 1) >= frame { b -= 1 }
            while start(b) < frame {
                b += 1
                if let bars, b >= bars { break }
            }
            if let bars, b >= bars { continue }
            return item.firstBar + Int(b)
        }
        return nil
    }

    /// A new plan identical up to (not including) `bar`, with `transform`
    /// applied to every segment from that bar on. Events before `bar` keep
    /// exactly the same frames, so the switch is seamless.
    public func changing(fromBar bar: Int, _ transform: (inout PlaybackSegment) throws -> Void) throws -> PlaybackPlan {
        guard let index = segmentIndex(containingBar: bar) else {
            throw TimingError.invalidPlan("bar \(bar) is outside the plan")
        }
        let item = resolved[index]
        let offset = bar - item.firstBar
        var newSegments = Array(segments[..<index])
        var tail = Array(segments[index...])
        if offset > 0 {
            var head = tail[0]
            head.bars = offset
            newSegments.append(head)
            if let bars = tail[0].bars { tail[0].bars = bars - offset }
        }
        for i in tail.indices { try transform(&tail[i]) }
        return try PlaybackPlan(sampleRate: sampleRate, segments: newSegments + tail, startFrame: startFrame)
    }

    /// Convenience: switch tempo starting at `bar`.
    public func changingTempo(to tempo: Tempo, fromBar bar: Int) throws -> PlaybackPlan {
        try changing(fromBar: bar) { $0.tempo = tempo }
    }

    // MARK: Internals

    private func segmentIndex(containingBar bar: Int) -> Int? {
        for (index, item) in resolved.enumerated() where bar >= item.firstBar {
            if let bars = item.segment.bars, bar >= item.firstBar + bars { continue }
            return index
        }
        return nil
    }

    /// Visits every grid point (audible or muted) in the window, in order.
    private func forEachGridPoint(in frames: Range<Int64>, _ body: (Int, Int64, Int64) -> Void) {
        guard !frames.isEmpty else { return }
        for (segmentIndex, item) in resolved.enumerated() {
            if let count = item.eventCount, item.frame(ofEvent: count) <= frames.lowerBound { continue }
            if item.frame(ofEvent: 0) >= frames.upperBound { break }

            var k = item.estimatedFirstEvent(atOrAfter: frames.lowerBound)
            while k > 0 && item.frame(ofEvent: k - 1) >= frames.lowerBound { k -= 1 }
            while item.frame(ofEvent: k) < frames.lowerBound { k += 1 }

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

    func exactPoint(ofEvent k: Int64) -> TimelinePoint {
        anchor + Rational(k) * step
    }

    func frame(ofEvent k: Int64) -> Int64 {
        exactPoint(ofEvent: k).roundedHalfUp
    }

    /// Floating-point guess, corrected exactly by the caller.
    func estimatedFirstEvent(atOrAfter frame: Int64) -> Int64 {
        let guess = ((Double(frame) - anchor.doubleValue) / step.doubleValue).rounded(.down)
        guard guess.isFinite, guess > 1 else { return 0 }
        let k = Int64(min(guess, 9.0e15)) - 1
        if let count = eventCount { return min(k, count) }
        return k
    }
}
