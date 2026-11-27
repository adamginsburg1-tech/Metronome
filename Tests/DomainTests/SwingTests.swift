import XCTest
@testable import PocketDomain

/// Swing (plan §07): only the second note of each pair moves; beats stay exact.
final class SwingTests: XCTestCase {
    func testSwungEighthsAndSixteenths() throws {
        // 120 BPM at 48 kHz: beat 24 000 frames.
        let eighths = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, subdivision: 2, swing: 60), tempo: Tempo(bpm: 120), sampleRate: 48_000)
        XCTAssertEqual(eighths.events(in: 0..<48_000).map(\.frame), [0, 14_400, 24_000, 38_400])
        let sixteenths = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, subdivision: 4, swing: 60), tempo: Tempo(bpm: 120), sampleRate: 48_000)
        XCTAssertEqual(sixteenths.events(in: 0..<24_001).map(\.frame), [0, 7_200, 12_000, 19_200, 24_000])
    }

    func testTripletsIgnoreSwingAndRangeIsChecked() throws {
        let triplets = try PlaybackPlan.click(pattern: ClickPattern(meter: .fourFour, subdivision: 3, swing: 70), tempo: Tempo(bpm: 120), sampleRate: 48_000)
        XCTAssertEqual(triplets.events(in: 0..<24_000).map(\.frame), [0, 8_000, 16_000])
        XCTAssertThrowsError(try ClickPattern(meter: .fourFour, subdivision: 2, swing: 80))
        XCTAssertThrowsError(try ClickPattern(meter: .fourFour, subdivision: 2, swing: 49))
    }

    func testWindowsStayExactWithSwing() throws {
        let plan = try PlaybackPlan.click(pattern: ClickPattern(meter: .sevenEight, subdivision: 4, swing: 67), tempo: Tempo(bpm: 211, beatUnit: .eighth), sampleRate: 44_100)
        let total: Int64 = 44_100 * 30
        var got: [ClickEvent] = []
        var cursor: Int64 = 0
        while cursor < total {
            let end = min(total, cursor + 1_733)
            got += plan.events(in: cursor..<end)
            cursor = end
        }
        XCTAssertEqual(got, plan.events(in: 0..<total))
        let frames = got.map(\.frame)
        XCTAssertEqual(frames, frames.sorted())
    }
}
