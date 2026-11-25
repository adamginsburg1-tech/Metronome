import XCTest
@testable import PocketDomain

/// Clock-math gates from the plan (§10 "Clock math"): every onset within one
/// sample frame of its exact time, no cumulative drift over 60 minutes, and
/// all meter/subdivision combinations covered.
final class PlaybackPlanTests: XCTestCase {
    let sampleRates = [44_100, 48_000, 96_000]

    // MARK: Exact grids

    func testQuarterNotesAt60_120_300BPM() throws {
        for (bpm, interval) in [(60.0, Int64(48_000)), (120, 24_000), (300, 9_600)] {
            let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour), tempo: Tempo(bpm: bpm), sampleRate: 48_000)
            let events = plan.events(in: 0..<(interval * 16))
            XCTAssertEqual(events.count, 16, "\(bpm) BPM")
            for (k, event) in events.enumerated() {
                XCTAssertEqual(event.frame, Int64(k) * interval, "\(bpm) BPM event \(k)")
                XCTAssertEqual(event.bar, k / 4)
                XCTAssertEqual(event.unit, k % 4)
                XCTAssertEqual(event.level, k % 4 == 0 ? .downbeat : .normal)
            }
        }
    }

    func testSevenEightGroupedTwoTwoThree() throws {
        // Eighth = 120 → 24 000 frames per eighth at 48 kHz.
        let pattern = try ClickPattern(meter: Meter(7, 8, grouping: [2, 2, 3]))
        let plan = try PlaybackPlan.click(pattern: pattern, tempo: Tempo(bpm: 120, beatUnit: .eighth), sampleRate: 48_000)
        let events = plan.events(in: 0..<(24_000 * 14))
        XCTAssertEqual(events.map(\.frame), (0..<14).map { Int64($0) * 24_000 })
        XCTAssertEqual(events.prefix(7).map(\.level), [.downbeat, .normal, .group, .normal, .group, .normal, .normal])
        XCTAssertEqual(events[7].bar, 1)
        XCTAssertEqual(events[7].level, .downbeat)
    }

    func testSixEightDottedQuarterBeat() throws {
        // Dotted quarter = 60 → one bar (two dotted quarters) = 2 s.
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .sixEight), tempo: Tempo(bpm: 60, beatUnit: .dottedQuarter), sampleRate: 48_000)
        XCTAssertEqual(plan.startFrame(ofBar: 1), 96_000)
        let events = plan.events(in: 0..<96_000)
        XCTAssertEqual(events.count, 6)
        XCTAssertEqual(events.map(\.frame), [0, 16_000, 32_000, 48_000, 64_000, 80_000])
        XCTAssertEqual(events.map(\.level), [.downbeat, .normal, .normal, .group, .normal, .normal])
    }

    // MARK: Every onset within half a frame of exact time

    func testAllMeterSubdivisionCombinationsAreExact() throws {
        let meters: [Meter] = try [
            Meter(4, 4), Meter(3, 4), Meter(5, 4), Meter(2, 2),
            Meter(6, 8), Meter(7, 8), Meter(7, 8, grouping: [3, 2, 2]), Meter(9, 8), Meter(11, 8), Meter(5, 16),
        ]
        let tempos = [20.0, 60, 113.37, 120, 187.5, 300]
        for sampleRate in sampleRates {
            for meter in meters {
                for subdivision in ClickPattern.supportedSubdivisions {
                    for bpm in tempos {
                        let tempo = try Tempo(bpm: bpm, beatUnit: meter.defaultBeatUnit)
                        let pattern = try ClickPattern(meter: meter, subdivision: subdivision)
                        let plan = try PlaybackPlan.click(pattern: pattern, tempo: tempo, sampleRate: sampleRate)
                        let events = plan.events(in: 0..<Int64(sampleRate * 20))
                        let stepFrames = tempo.framesPerWholeNote(sampleRate: sampleRate) * pattern.stepLength
                        for (k, event) in events.enumerated() {
                            let exact = Rational(Int64(k)) * stepFrames
                            let error = (Rational(event.frame) - exact)
                            XCTAssertTrue(error <= .half && -error < .half,
                                          "\(meter) sub \(subdivision) \(bpm) BPM @\(sampleRate): event \(k) off by \(error)")
                        }
                        let expectedCount = (Rational(Int64(sampleRate * 20)) / stepFrames).ceil
                        XCTAssertEqual(Int64(events.count), expectedCount, "\(meter) sub \(subdivision) \(bpm) BPM @\(sampleRate)")
                    }
                }
            }
        }
    }

    func testNoCumulativeDriftOverSixtyMinutes() throws {
        // Septuplets at a tempo whose interval is not a whole number of frames.
        let sampleRate = 48_000
        let tempo = try Tempo(bpm: 113.37)
        let pattern = try ClickPattern(meter: .fourFour, subdivision: 7)
        let plan = try PlaybackPlan.click(pattern: pattern, tempo: tempo, sampleRate: sampleRate)
        let hour = Int64(sampleRate * 3_600)
        let events = plan.events(in: 0..<hour)

        let intervalSeconds = 60.0 / 113.37 / 7.0
        XCTAssertEqual(events.count, Int((3_600 / intervalSeconds).rounded(.up)))

        var maxError = 0.0
        for (k, event) in events.enumerated() {
            let exactFrame = Double(k) * intervalSeconds * Double(sampleRate)
            maxError = max(maxError, abs(Double(event.frame) - exactFrame))
        }
        XCTAssertLessThanOrEqual(maxError, 0.5 + 1e-6, "max onset error \(maxError) frames")

        // Why this matters: adding a rounded interval each time drifts by many frames.
        let roundedInterval = (intervalSeconds * Double(sampleRate)).rounded()
        let naiveLast = roundedInterval * Double(events.count - 1)
        let exactLast = intervalSeconds * Double(sampleRate) * Double(events.count - 1)
        XCTAssertGreaterThan(abs(naiveLast - exactLast), 100)
    }

    // MARK: Lookahead windows

    func testAdjacentWindowsNeverDuplicateOrSkip() throws {
        let pattern = try ClickPattern(meter: Meter(7, 8), subdivision: 5)
        let plan = try PlaybackPlan.click(pattern: pattern, tempo: Tempo(bpm: 241.3, beatUnit: .eighth), countInBars: 2, sampleRate: 44_100)
        let total = Int64(44_100 * 120)
        let reference = plan.events(in: 0..<total)

        var generator = SplitMix64(seed: 42)
        var collected: [ClickEvent] = []
        var cursor: Int64 = 0
        while cursor < total {
            // Windows from 1 frame up to ~200 ms, like a render callback with jitter.
            let size = Int64(generator.next() % 8_820) + 1
            let end = min(total, cursor + size)
            collected += plan.events(in: cursor..<end)
            cursor = end
        }
        XCTAssertEqual(collected, reference)
        XCTAssertEqual(Set(collected.map(\.frame)).count, collected.count, "duplicate frames")
    }

    func testWindowDeepIntoPlaybackMatchesFullScan() throws {
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, subdivision: 3), tempo: Tempo(bpm: 97.5), sampleRate: 48_000)
        let start = Int64(48_000 * 3_000) // 50 minutes in
        let window = plan.events(in: start..<(start + 48_000))
        let all = plan.events(in: 0..<(start + 48_000)).filter { $0.frame >= start }
        XCTAssertEqual(window, all)
        XCTAssertFalse(window.isEmpty)
    }

    func testStartFrameOffsetsEverything() throws {
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour), tempo: Tempo(bpm: 120), sampleRate: 48_000, startFrame: 1_000)
        XCTAssertEqual(plan.events(in: 0..<50_000).map(\.frame), [1_000, 25_000, 49_000])
    }

    // MARK: Count-in, muting, segments

    func testCountInPrecedesBarZeroWithoutSubdivisions() throws {
        let pattern = try ClickPattern(meter: .fourFour, subdivision: 2)
        let plan = try PlaybackPlan.click(pattern: pattern, tempo: Tempo(bpm: 120), countInBars: 1, sampleRate: 48_000)
        let events = plan.events(in: 0..<(96_000 + 48_000))
        let countIn = events.filter { $0.role == .countIn }
        XCTAssertEqual(countIn.map(\.frame), [0, 24_000, 48_000, 72_000])
        XCTAssertEqual(countIn.map(\.bar), [-1, -1, -1, -1])
        let music = events.filter { $0.role == .music }
        XCTAssertEqual(music.first?.frame, 96_000)
        XCTAssertEqual(music.first?.bar, 0)
        XCTAssertEqual(music.first?.level, .downbeat)
        XCTAssertEqual(music.map(\.frame), [96_000, 108_000, 120_000, 132_000])
        XCTAssertEqual(plan.startFrame(ofBar: 0), 96_000)
        XCTAssertEqual(plan.startFrame(ofBar: -1), 0)
    }

    func testMutedUnitsKeepTheClockRunning() throws {
        let pattern = try ClickPattern(meter: .fourFour, accents: [.downbeat, .muted, .normal, .muted], subdivisionLevel: .muted)
        let plan = try PlaybackPlan.click(pattern: pattern, tempo: Tempo(bpm: 120), countInBars: 1, sampleRate: 48_000)
        let events = plan.events(in: 0..<(96_000 * 2))
        // Count-in sounds every unit; music sounds only unmuted ones.
        XCTAssertEqual(events.filter { $0.role == .countIn }.count, 4)
        XCTAssertEqual(events.filter { $0.role == .music }.map(\.frame), [96_000, 144_000])
    }

    func testFiniteSegmentsAndEndFrame() throws {
        let pattern = try ClickPattern(meter: .fourFour)
        let plan = try PlaybackPlan(sampleRate: 48_000, segments: [
            PlaybackSegment(pattern: pattern, tempo: Tempo(bpm: 120), bars: 2),
            PlaybackSegment(pattern: pattern, tempo: Tempo(bpm: 60), bars: 1),
        ])
        XCTAssertEqual(plan.endFrame, 96_000 * 2 + 192_000)
        let frames = plan.events(in: 0..<1_000_000).map(\.frame)
        XCTAssertEqual(frames, [0, 24_000, 48_000, 72_000, 96_000, 120_000, 144_000, 168_000,
                                192_000, 240_000, 288_000, 336_000])
        XCTAssertNil(plan.startFrame(ofBar: 3))
    }

    func testRejectsInvalidPlans() throws {
        let pattern = try ClickPattern(meter: .fourFour)
        let tempo = try Tempo(bpm: 120)
        XCTAssertThrowsError(try PlaybackPlan(sampleRate: 48_000, segments: []))
        XCTAssertThrowsError(try PlaybackPlan(sampleRate: 100, segments: [PlaybackSegment(pattern: pattern, tempo: tempo)]))
        XCTAssertThrowsError(try PlaybackPlan(sampleRate: 48_000, segments: [
            PlaybackSegment(pattern: pattern, tempo: tempo),
            PlaybackSegment(pattern: pattern, tempo: tempo, bars: 1),
        ]))
        XCTAssertThrowsError(try PlaybackPlan(sampleRate: 48_000, segments: [PlaybackSegment(pattern: pattern, tempo: tempo, bars: 0)]))
    }

    // MARK: Changing tempo while running

    func testTempoChangeAtNextBarKeepsEarlierEventsIdentical() throws {
        let original = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, subdivision: 2), tempo: Tempo(bpm: 112.3), countInBars: 1, sampleRate: 48_000)
        // User taps +5 at roughly 7.3 s; apply on the next bar.
        let now: Int64 = 350_400
        let bar = try XCTUnwrap(original.firstBar(startingAtOrAfter: now))
        let boundary = try XCTUnwrap(original.startFrame(ofBar: bar))
        XCTAssertGreaterThanOrEqual(boundary, now)
        XCTAssertLessThan(try XCTUnwrap(original.startFrame(ofBar: bar - 1)), now)

        let changed = try original.changingTempo(to: Tempo(bpm: 117.3), fromBar: bar)
        XCTAssertEqual(changed.events(in: 0..<boundary), original.events(in: 0..<boundary))
        XCTAssertEqual(changed.startFrame(ofBar: bar), boundary)

        let after = changed.events(in: boundary..<(boundary + 48_000 * 10))
        XCTAssertEqual(after.first?.frame, boundary)
        XCTAssertEqual(after.first?.level, .downbeat)
        // Measure from the exact (fractional) bar start, not the rounded frame:
        // count-in bar + `bar` music bars at 112.3, then eighths at 117.3.
        let exactBoundary = Double(bar + 1) * 4 * 48_000 * 60 / 112.3
        let eighth = 48_000.0 * 60 / 117.3 / 2
        for (k, event) in after.enumerated() {
            XCTAssertLessThanOrEqual(abs(Double(event.frame) - (exactBoundary + Double(k) * eighth)), 0.5 + 1e-5)
        }
        XCTAssertEqual(after.map(\.bar).first, bar)
    }

    func testManyTempoChangesStayExactAndDoNotOverflow() throws {
        // A long practice ladder: +1 BPM every bar for 180 bars, primes included.
        var plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, subdivision: 7), tempo: Tempo(bpm: 101), sampleRate: 44_100)
        for bar in 1...180 {
            plan = try plan.changingTempo(to: Tempo(bpm: Rational(Int64(101 + bar))), fromBar: bar)
        }
        // Independently sum bar durations to bar 180. (An exact rational sum of
        // 180 prime denominators would overflow Int64 — the reason the plan
        // quantizes segment boundaries to 2⁻²⁰ frame.)
        var exact = 0.0
        for bar in 0..<180 {
            exact += 44_100.0 * 60 * 4 / Double(101 + bar)
        }
        let frame = try XCTUnwrap(plan.startFrame(ofBar: 180))
        XCTAssertLessThanOrEqual(abs(Double(frame) - exact), 0.5 + 1e-3)
        XCTAssertEqual(plan.events(in: frame..<(frame + 1)).first?.level, .downbeat)
    }

    func testFirstBarStartingAtOrAfter() throws {
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour), tempo: Tempo(bpm: 120), countInBars: 1, sampleRate: 48_000)
        XCTAssertEqual(plan.firstBar(startingAtOrAfter: 0), -1)
        XCTAssertEqual(plan.firstBar(startingAtOrAfter: 1), 0)
        XCTAssertEqual(plan.firstBar(startingAtOrAfter: 96_000), 0)
        XCTAssertEqual(plan.firstBar(startingAtOrAfter: 96_001), 1)
        XCTAssertEqual(plan.firstBar(startingAtOrAfter: 96_000 * 101), 100)
    }
}

/// Small deterministic RNG so the window test is reproducible.
struct SplitMix64 {
    private var state: UInt64
    init(seed: UInt64) { state = seed }
    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
