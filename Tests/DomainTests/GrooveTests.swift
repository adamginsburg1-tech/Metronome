import XCTest
@testable import PocketDomain

/// Grooves (D-033, D-035). Same cases and values as web/test/timing.test.js, in frames at 48 kHz.
final class GrooveTests: XCTestCase {
    let rock = try! Groove(stepsPerUnit: 4, lanes: [
        "kick": [3, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0],
        "hat": [2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0],
    ])
    let eighths = [2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0]

    func plan(_ subdivision: Int = 1, swing: Int = 50, bpm: Double = 120, countIn: Int = 0, gaps: GapPattern = .off, start: Int64 = 0) throws -> PlaybackPlan {
        try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, subdivision: subdivision, swing: swing), tempo: Tempo(bpm: bpm),
                               countInBars: countIn, sampleRate: 48_000, startFrame: start, gaps: gaps)
    }

    func testHitsFallOnTheSixteenthGridAtTempo() throws {
        let hits = try plan().grooveHits(in: 0..<96_000, groove: rock)
        XCTAssertEqual(hits.filter { $0.lane == "hat" }.map(\.frame), (0..<8).map { Int64($0) * 12_000 })
        XCTAssertEqual(hits.filter { $0.lane == "kick" }.map(\.frame), [0, 48_000])
    }

    func testWindowsNeverRepeatOrSkip() throws {
        let p = try plan(2, swing: 62, bpm: 137, countIn: 1, start: 14_400)
        let total: Int64 = 48_000 * 20
        var got: [GrooveHit] = []
        var cursor: Int64 = 0
        while cursor < total {
            let end = min(total, cursor + 1_777)
            got += p.grooveHits(in: cursor..<end, groove: rock)
            cursor = end
        }
        XCTAssertEqual(got, p.grooveHits(in: 0..<total, groove: rock))
        XCTAssertFalse(got.isEmpty)
    }

    func testCountInIsSilentAndOffbeatsLandOnSwungClicks() throws {
        let p = try plan(2, swing: 66, bpm: 100, countIn: 1)
        let hits = p.grooveHits(in: 0..<48_000 * 30, groove: rock)
        XCTAssertGreaterThanOrEqual(hits[0].frame, try XCTUnwrap(p.startFrame(ofBar: 0)))
        let offClicks = p.events(in: 0..<48_000 * 30).filter { $0.role == .music && $0.subdivision == 1 }.map(\.frame)
        let offHats = hits.filter { $0.lane == "hat" && $0.step % 4 == 2 }.map(\.frame)
        for (i, frame) in offHats.enumerated() { XCTAssertEqual(frame, offClicks[i]) }
    }

    func testTempoChangeMidBarAndGapBars() throws {
        let changed = try plan(gaps: .cycle(play: 1, mute: 1)).changingTempo(to: Tempo(bpm: 60), at: BarPosition(bar: 0, grid: 2))
        let hats = changed.grooveHits(in: 0..<48_000 * 6, groove: rock).filter { $0.lane == "hat" }
        XCTAssertEqual(hats.filter { $0.bar == 0 }.map(\.frame), [0, 12_000, 24_000, 36_000, 48_000, 72_000, 96_000, 120_000])
        XCTAssertTrue(hats.filter { $0.bar == 1 }.isEmpty)
    }

    func testEighthGrooveSwingsOverAQuarterNoteClick() throws {
        let p = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, swing: 66), tempo: Tempo(bpm: 60), sampleRate: 48_000)
        let g = try Groove(stepsPerUnit: 4, lanes: ["hat": [2, 0, 2, 0]])
        XCTAssertEqual(p.grooveHits(in: 0..<96_000, groove: g).map(\.frame), [0, 31_680, 48_000, 79_680])
        XCTAssertEqual(p.events(in: 0..<96_000).map(\.frame), [0, 48_000])
    }

    func testSixteenthGrooveSwingsSixteenthsUnderAQuarterNoteClick() throws {
        let g = try Groove(stepsPerUnit: 4, lanes: ["hat": Array(repeating: 2, count: 16)])
        XCTAssertEqual(try plan(swing: 66).grooveHits(in: 0..<24_000, groove: g).map(\.frame), [0, 7_920, 12_000, 19_920])
    }

    func testEighthGrooveSwingsEighthsUnderASixteenthNoteClick() throws {
        let g = try Groove(stepsPerUnit: 4, lanes: ["hat": eighths])
        XCTAssertEqual(try plan(4, swing: 66).grooveHits(in: 0..<24_000, groove: g).map(\.frame), [0, 15_840])
    }

    func testPlayheadLaneDoesNotChangePairing() throws {
        let g = try Groove(stepsPerUnit: 4, lanes: ["hat": eighths, Groove.playheadLane: Array(repeating: 1, count: 16)])
        XCTAssertEqual(g.pairSteps, 4)
        let hats = try plan(swing: 67).grooveHits(in: 0..<48_000, groove: g).filter { $0.lane == "hat" }
        XCTAssertEqual(hats.map(\.frame), [0, 16_080, 24_000, 40_080])
    }

    func testPairsRestartEachBarInSevenEight() throws {
        // 7/8 at 120 per eighth: 14 sixteenths per bar, eighth hats; the off-eighths of
        // pairs (steps 2, 6, 10) move, step 12 starts a pair, and bar 2 starts straight.
        let p = try PlaybackPlan.click(pattern: ClickPattern(meter: .sevenEight, swing: 75), tempo: Tempo(bpm: 120, beatUnit: .eighth), sampleRate: 48_000)
        let g = try Groove(stepsPerUnit: 2, lanes: ["hat": [2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0]])
        let frames = p.grooveHits(in: 0..<(7 * 24_000 + 1), groove: g).map(\.frame)
        XCTAssertEqual(frames, [0, 36_000, 48_000, 84_000, 96_000, 132_000, 144_000, 168_000])
    }

    func testSegmentFrames() throws {
        let p = try plan(countIn: 1)
        let first = try XCTUnwrap(p.segmentFrames(0))
        XCTAssertEqual(first.start, 0)
        XCTAssertEqual(first.end, 96_000)
        XCTAssertNil(try XCTUnwrap(p.segmentFrames(1)).end)
        XCTAssertNil(p.segmentFrames(2))
    }
}
