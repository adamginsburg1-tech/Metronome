/// An exact fraction backed by `Int64`.
///
/// All musical positions and durations in POCKET are rationals so that tuplets
/// (e.g. septuplets) and fractional tempos never accumulate rounding error.
/// Values are always stored in lowest terms with a positive denominator.
/// Arithmetic traps on overflow rather than silently producing a wrong time.
public struct Rational: Sendable, Hashable, Comparable, CustomStringConvertible {
    public let numerator: Int64
    public let denominator: Int64

    public init(_ numerator: Int64, _ denominator: Int64 = 1) {
        precondition(denominator != 0, "Rational denominator must be non-zero")
        let divisor = Rational.gcd(numerator, denominator)
        var n = numerator / divisor
        var d = denominator / divisor
        if d < 0 {
            n = -n
            d = -d
        }
        self.numerator = n
        self.denominator = d
    }

    public init(_ value: Int) {
        self.init(Int64(value), 1)
    }

    public static let zero = Rational(0)
    public static let one = Rational(1)
    public static let half = Rational(1, 2)

    /// Nearest rational with the given denominator (round half up).
    public static func approximating(_ value: Double, denominator: Int64) -> Rational {
        precondition(value.isFinite, "Cannot approximate a non-finite value")
        let scaled = (value * Double(denominator) + 0.5).rounded(.down)
        return Rational(Int64(scaled), denominator)
    }

    public var doubleValue: Double { Double(numerator) / Double(denominator) }

    /// Largest integer ≤ self.
    public var floor: Int64 {
        let remainder = ((numerator % denominator) + denominator) % denominator
        return (numerator - remainder) / denominator
    }

    /// Smallest integer ≥ self.
    public var ceil: Int64 { -(-self).floor }

    /// Nearest integer; exact halves round up (toward +∞).
    public var roundedHalfUp: Int64 { (self + .half).floor }

    /// self − floor(self), always in [0, 1).
    public var fractionalPart: Rational { self - Rational(floor) }

    public var isInteger: Bool { denominator == 1 }

    public var description: String {
        denominator == 1 ? "\(numerator)" : "\(numerator)/\(denominator)"
    }

    // MARK: Arithmetic

    public static prefix func - (value: Rational) -> Rational {
        Rational(-value.numerator, value.denominator)
    }

    public static func + (lhs: Rational, rhs: Rational) -> Rational {
        let g = gcd(lhs.denominator, rhs.denominator)
        let n = lhs.numerator * (rhs.denominator / g) + rhs.numerator * (lhs.denominator / g)
        return Rational(n, (lhs.denominator / g) * rhs.denominator)
    }

    public static func - (lhs: Rational, rhs: Rational) -> Rational {
        lhs + (-rhs)
    }

    public static func * (lhs: Rational, rhs: Rational) -> Rational {
        // Cross-reduce first to keep intermediates small.
        let g1 = gcd(lhs.numerator, rhs.denominator)
        let g2 = gcd(rhs.numerator, lhs.denominator)
        let n = (lhs.numerator / g1) * (rhs.numerator / g2)
        let d = (lhs.denominator / g2) * (rhs.denominator / g1)
        return Rational(n, d)
    }

    public static func / (lhs: Rational, rhs: Rational) -> Rational {
        precondition(rhs.numerator != 0, "Division by zero")
        return lhs * Rational(rhs.denominator, rhs.numerator)
    }

    public static func < (lhs: Rational, rhs: Rational) -> Bool {
        let g = gcd(lhs.denominator, rhs.denominator)
        return lhs.numerator * (rhs.denominator / g) < rhs.numerator * (lhs.denominator / g)
    }

    static func gcd(_ a: Int64, _ b: Int64) -> Int64 {
        var x = a.magnitude
        var y = b.magnitude
        while y != 0 {
            (x, y) = (y, x % y)
        }
        return x == 0 ? 1 : Int64(x)
    }
}
