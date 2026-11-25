import XCTest
@testable import PocketDomain

final class MeterAndPatternTests: XCTestCase {
    func testDefaultGroupings() throws {
        XCTAssertEqual(try Meter(4, 4).grouping, [1, 1, 1, 1])
        XCTAssertEqual(try Meter(6, 8).grouping, [3, 3])
        XCTAssertEqual(try Meter(12, 8).grouping, [3, 3, 3, 3])
        XCTAssertEqual(try Meter(7, 8).grouping, [2, 2, 3])
        XCTAssertEqual(try Meter(5, 8).grouping, [2, 3])
        XCTAssertEqual(try Meter(3, 8).grouping, [1, 1, 1])
    }

    func testCustomGroupingMustSumToNumerator() {
        XCTAssertNoThrow(try Meter(7, 8, grouping: [3, 2, 2]))
        XCTAssertThrowsError(try Meter(7, 8, grouping: [3, 3]))
        XCTAssertThrowsError(try Meter(7, 8, grouping: [7, 0]))
    }

    func testRejectsUnsupportedMeters() {
        XCTAssertThrowsError(try Meter(0, 4))
        XCTAssertThrowsError(try Meter(4, 3))
        XCTAssertThrowsError(try Meter(33, 8))
    }

    func testBeatUnits() throws {
        XCTAssertEqual(try Meter(6, 8).defaultBeatUnit, .dottedQuarter)
        XCTAssertEqual(try Meter(4, 4).defaultBeatUnit, .quarter)
        XCTAssertEqual(try Meter(7, 8).defaultBeatUnit, .eighth)
        XCTAssertEqual(try Meter(2, 2).defaultBeatUnit, .half)
    }

    func testDefaultAccentsFollowGrouping() throws {
        let pattern = try ClickPattern(meter: .sevenEight)
        XCTAssertEqual(pattern.accents, [.downbeat, .normal, .group, .normal, .group, .normal, .normal])
    }

    func testSubdivisionGridLevels() throws {
        let pattern = try ClickPattern(meter: .fourFour, subdivision: 3)
        XCTAssertEqual(pattern.eventsPerBar, 12)
        XCTAssertEqual(pattern.stepLength, Rational(1, 12))
        XCTAssertEqual(pattern.level(atGridIndex: 0), .downbeat)
        XCTAssertEqual(pattern.level(atGridIndex: 1), .subdivision)
        XCTAssertEqual(pattern.level(atGridIndex: 3), .normal)
    }

    func testValidation() {
        XCTAssertThrowsError(try ClickPattern(meter: .fourFour, subdivision: 0))
        XCTAssertThrowsError(try ClickPattern(meter: .fourFour, subdivision: 9))
        XCTAssertThrowsError(try ClickPattern(meter: .fourFour, accents: [.downbeat]))
        XCTAssertThrowsError(try Tempo(bpm: 19.99))
        XCTAssertThrowsError(try Tempo(bpm: 300.01))
        XCTAssertNoThrow(try Tempo(bpm: 20))
        XCTAssertNoThrow(try Tempo(bpm: 300))
    }

    func testFramesPerWholeNote() throws {
        // 120 quarter-note BPM → whole note = 2 s = 96 000 frames at 48 kHz.
        XCTAssertEqual(try Tempo(bpm: 120).framesPerWholeNote(sampleRate: 48_000), Rational(96_000))
        // Dotted quarter = 60 → whole note = 8/3 s.
        XCTAssertEqual(try Tempo(bpm: 60, beatUnit: .dottedQuarter).framesPerWholeNote(sampleRate: 48_000), Rational(128_000))
    }
}
