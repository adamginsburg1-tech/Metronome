import XCTest
@testable import PocketDomain

final class RationalTests: XCTestCase {
    func testNormalizesSignAndLowestTerms() {
        let value = Rational(6, -8)
        XCTAssertEqual(value.numerator, -3)
        XCTAssertEqual(value.denominator, 4)
        XCTAssertEqual(Rational(0, -5), Rational.zero)
    }

    func testArithmetic() {
        XCTAssertEqual(Rational(1, 3) + Rational(1, 6), Rational(1, 2))
        XCTAssertEqual(Rational(1, 3) - Rational(1, 2), Rational(-1, 6))
        XCTAssertEqual(Rational(3, 8) * Rational(4, 9), Rational(1, 6))
        XCTAssertEqual(Rational(3, 8) / Rational(3, 4), Rational(1, 2))
        XCTAssertTrue(Rational(1, 3) < Rational(34, 100))
        XCTAssertFalse(Rational(-1, 2) < Rational(-1, 2))
    }

    func testFloorCeilRound() {
        XCTAssertEqual(Rational(7, 2).floor, 3)
        XCTAssertEqual(Rational(-7, 2).floor, -4)
        XCTAssertEqual(Rational(7, 2).ceil, 4)
        XCTAssertEqual(Rational(-7, 2).ceil, -3)
        XCTAssertEqual(Rational(5, 2).roundedHalfUp, 3)
        XCTAssertEqual(Rational(-5, 2).roundedHalfUp, -2)
        XCTAssertEqual(Rational(7, 3).roundedHalfUp, 2)
        XCTAssertEqual(Rational(-7, 3).fractionalPart, Rational(2, 3))
    }

    func testApproximatingDouble() {
        XCTAssertEqual(Rational.approximating(112.5, denominator: 100), Rational(225, 2))
        XCTAssertEqual(Rational.approximating(113.333, denominator: 100), Rational(11333, 100))
    }

    func testTimelinePointCarriesFractions() {
        let start = TimelinePoint(whole: 10, fraction: Rational(3, 4))
        let moved = start + Rational(5, 2)
        XCTAssertEqual(moved.whole, 13)
        XCTAssertEqual(moved.fraction, Rational(1, 4))
        XCTAssertEqual(moved.roundedHalfUp, 13)
        XCTAssertEqual((start + Rational(-1, 1)).whole, 9)
    }
}
