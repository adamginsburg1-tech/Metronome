import XCTest
@testable import PocketDomain

/// Tempo changes on the next beat (Docs/UX.md O-1) and segments that start mid-bar.
final class BeatChangeTests: XCTestCase {
    func testBeatGridsFollowBeatUnit() throws {
        XCTAssertEqual(try ClickPattern(meter: .fourFour, subdivision: 2).beatGrids(beatUnit: .quarter), [0, 2, 4, 6])
        XCTAssertEqual(try ClickPattern(meter: .sixEight).beatGrids(beatUnit: .dottedQuarter), [0, 3])
        XCTAssertEqual(try ClickPattern(meter: .sevenEight).beatGrids(beatUnit: .eighth), [0, 1, 2, 3, 4, 5, 6])
    }

    func testTempoChangeOnNextBeatLandsMidBar() throws {
        // 120 BPM eighths at 48 kHz: 12 000 frames per eighth, beats every 24 000.
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, subdivision: 2), tempo: Tempo(bpm: 120), sampleRate: 48_000)
        let position = try XCTUnwrap(plan.firstBoundary(atOrAfter: 14_400, unit: .beat))
        XCTAssertEqual(position, BarPosition(bar: 0, grid: 2))

        let changed = try plan.changingTempo(to: Tempo(bpm: 60), at: position)
        XCTAssertEqual(changed.events(in: 0..<24_000), plan.events(in: 0..<24_000))

        // From beat 2: eighths at 60 BPM = 24 000 frames apart; bar keeps counting.
        let after = changed.events(in: 24_000..<(24_000 + 24_000 * 8))
        XCTAssertEqual(after.map(\.frame), (0..<8).map { 24_000 + Int64($0) * 24_000 })
        XCTAssertEqual(after.prefix(6).map(\.position), [
            BarPosition(bar: 0, grid: 2), BarPosition(bar: 0, grid: 3), BarPosition(bar: 0, grid: 4),
            BarPosition(bar: 0, grid: 5), BarPosition(bar: 0, grid: 6), BarPosition(bar: 0, grid: 7),
        ])
        XCTAssertEqual(after[6].bar, 1)
        XCTAssertEqual(after[6].level, .downbeat)
        XCTAssertEqual(changed.startFrame(ofBar: 1), 24_000 + 6 * 24_000)
    }

    func testNextBeatInSixEightIsTheNextDottedQuarter() throws {
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .sixEight), tempo: Tempo(bpm: 60, beatUnit: .dottedQuarter), sampleRate: 48_000)
        XCTAssertEqual(plan.firstBoundary(atOrAfter: 4_800, unit: .beat), BarPosition(bar: 0, grid: 3))
        XCTAssertEqual(plan.firstBoundary(atOrAfter: 52_800, unit: .beat), BarPosition(bar: 1, grid: 0))
        XCTAssertEqual(plan.firstBoundary(atOrAfter: 4_800, unit: .bar), BarPosition(bar: 1, grid: 0))
    }

    func testPatternChangeAfterMidBarTempoChangeLandsOnBarLine() throws {
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour), tempo: Tempo(bpm: 120), sampleRate: 48_000)
            .changingTempo(to: Tempo(bpm: 100), at: BarPosition(bar: 0, grid: 1))
        let threeFour = try ClickPattern(meter: .threeFour)
        let changed = try plan.changing(fromBar: 1) { $0.pattern = threeFour }
        // Beat 1 at 120 (24 000) + three beats at 100 (28 800 each).
        let bar1 = try XCTUnwrap(changed.startFrame(ofBar: 1))
        XCTAssertEqual(bar1, 24_000 + 3 * 28_800)
        XCTAssertEqual(changed.events(in: bar1..<(bar1 + 3 * 28_800)).map(\.level), [.downbeat, .normal, .normal])
        XCTAssertThrowsError(try plan.changing(at: BarPosition(bar: 0, grid: 2)) { $0.pattern = threeFour })
    }

    func testRepeatedBeatChangesStayExact() throws {
        // Nudge +1 BPM on every beat for 200 beats; earlier events must never move.
        var plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .sevenEight, subdivision: 3), tempo: Tempo(bpm: 150, beatUnit: .eighth), sampleRate: 44_100)
        var frame: Int64 = 0
        var reference: [ClickEvent] = []
        for n in 1...100 {
            let position = try XCTUnwrap(plan.firstBoundary(atOrAfter: frame + 1, unit: .beat))
            let boundary = try XCTUnwrap(plan.startFrame(of: position))
            let before = plan.events(in: 0..<boundary)
            plan = try plan.changingTempo(to: Tempo(bpm: Rational(Int64(150 + n)), beatUnit: .eighth), at: position)
            XCTAssertEqual(plan.events(in: 0..<boundary), before)
            reference = before
            frame = boundary
        }
        XCTAssertFalse(reference.isEmpty)
        XCTAssertEqual(Set(reference.map(\.frame)).count, reference.count)
    }
}

/// Immediate changes (owner, 2026-11-26): tempo on the next click, accents mid-bar.
final class ImmediateChangeTests: XCTestCase {
    func testStepBoundaryIsTheNextGridPoint() throws {
        // 120 BPM eighths at 48 kHz: 12 000 frames apart.
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, subdivision: 2), tempo: Tempo(bpm: 120), sampleRate: 48_000)
        XCTAssertEqual(plan.firstBoundary(atOrAfter: 9_600, unit: .step), BarPosition(bar: 0, grid: 1))
        XCTAssertEqual(plan.firstBoundary(atOrAfter: 12_001, unit: .step), BarPosition(bar: 0, grid: 2))
        let changed = try plan.changingTempo(to: Tempo(bpm: 60), at: BarPosition(bar: 0, grid: 1))
        XCTAssertEqual(changed.events(in: 0..<12_000), plan.events(in: 0..<12_000))
        XCTAssertEqual(changed.events(in: 12_000..<60_000).map(\.frame), [12_000, 36_000])
    }

    func testAccentsCanChangeMidBarButNotTheGrid() throws {
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour), tempo: Tempo(bpm: 120), sampleRate: 48_000)
        let accented = try ClickPattern(meter: .fourFour, accents: [.downbeat, .muted, .group, .normal])
        let changed = try plan.changing(at: BarPosition(bar: 0, grid: 1)) { $0.pattern = accented }
        XCTAssertEqual(changed.events(in: 0..<96_000).map(\.level), [.downbeat, .group, .normal])
        XCTAssertEqual(changed.events(in: 96_000..<192_000).map(\.level), [.downbeat, .group, .normal])
        let eighths = try ClickPattern(meter: .fourFour, subdivision: 2)
        XCTAssertThrowsError(try plan.changing(at: BarPosition(bar: 0, grid: 1)) { $0.pattern = eighths })
    }
}
