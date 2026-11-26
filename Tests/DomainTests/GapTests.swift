import XCTest
@testable import PocketDomain

/// Gap click (plan §07). The random sequence must match web/test/timing.test.js.
final class GapTests: XCTestCase {
    let jsSequence = "0000001000000001000000000101011000011001000100000110001000110000"

    func testCycleGapsAndCountIn() throws {
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour), tempo: Tempo(bpm: 120), countInBars: 1, sampleRate: 48_000, gaps: .cycle(play: 2, mute: 2))
        XCTAssertEqual((0..<8).map(plan.isGapBar), [false, false, true, true, false, false, true, true])
        XCTAssertFalse(plan.isGapBar(-1))
        let audible = plan.events(in: 0..<(96_000 * 9))
        XCTAssertEqual(audible.filter { $0.role == .countIn }.count, 4)
        XCTAssertEqual(Set(audible.filter { $0.role == .music }.map(\.bar)), [0, 1, 4, 5])
        let all = plan.events(in: 0..<(96_000 * 9), includeGaps: true)
        XCTAssertEqual(all.filter(\.gap).count, 16)
    }

    func testRandomGapsMatchTheWebCoreAndFollowTheRules() throws {
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour), tempo: Tempo(bpm: 120), sampleRate: 48_000, gaps: .random(percent: 30, seed: 12_345))
        XCTAssertEqual((0..<64).map { plan.isGapBar($0) ? "1" : "0" }.joined(), jsSequence)
        let long = try plan.withGaps(.random(percent: 30, seed: 42))
        let bars = (0..<5_000).map(long.isGapBar)
        XCTAssertFalse(bars[0] || bars[1])
        for b in 2..<bars.count { XCTAssertFalse(bars[b] && bars[b - 1] && bars[b - 2], "3 in a row at \(b)") }
    }

    func testGapsNeverMoveClicksAndSurviveChanges() throws {
        let plain = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, subdivision: 2), tempo: Tempo(bpm: 120), sampleRate: 48_000)
        let gapped = try plain.withGaps(.cycle(play: 1, mute: 1))
        XCTAssertEqual(gapped.events(in: 0..<400_000, includeGaps: true).map(\.frame), plain.events(in: 0..<400_000).map(\.frame))
        let changed = try gapped.changingTempo(to: Tempo(bpm: 90), fromBar: 1)
        XCTAssertEqual(changed.gaps, .cycle(play: 1, mute: 1))
        XCTAssertTrue(changed.isGapBar(1))
    }
}
