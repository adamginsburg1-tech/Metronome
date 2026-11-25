/// Errors raised when a timing configuration is outside what POCKET supports.
public enum TimingError: Error, Equatable, Sendable {
    case invalidMeter(String)
    case invalidGrouping(String)
    case invalidSubdivision(Int)
    case tempoOutOfRange(Rational)
    case invalidAccents(String)
    case invalidSampleRate(Int)
    case invalidPlan(String)
}

/// A note length expressed as a fraction of a whole note.
/// Quarter = 1/4, eighth = 1/8, dotted quarter = 3/8.
public struct NoteValue: Sendable, Hashable, CustomStringConvertible {
    public let wholeNotes: Rational

    public init(_ wholeNotes: Rational) {
        precondition(wholeNotes > .zero, "A note value must be positive")
        self.wholeNotes = wholeNotes
    }

    public static let half = NoteValue(Rational(1, 2))
    public static let quarter = NoteValue(Rational(1, 4))
    public static let dottedQuarter = NoteValue(Rational(3, 8))
    public static let eighth = NoteValue(Rational(1, 8))
    public static let dottedEighth = NoteValue(Rational(3, 16))
    public static let sixteenth = NoteValue(Rational(1, 16))

    public var description: String { "\(wholeNotes) whole" }
}

/// Time signature plus additive grouping.
///
/// The *meter unit* is the note named by the denominator (an eighth in 7/8).
/// `grouping` splits the bar's units into groups, e.g. 7/8 as [2, 2, 3];
/// group starts get a secondary accent by default.
public struct Meter: Sendable, Hashable, CustomStringConvertible {
    public static let supportedDenominators: Set<Int> = [1, 2, 4, 8, 16, 32]
    public static let maxNumerator = 32

    public let numerator: Int
    public let denominator: Int
    public let grouping: [Int]

    public init(_ numerator: Int, _ denominator: Int, grouping: [Int]? = nil) throws {
        guard (1...Meter.maxNumerator).contains(numerator) else {
            throw TimingError.invalidMeter("numerator \(numerator) must be 1...\(Meter.maxNumerator)")
        }
        guard Meter.supportedDenominators.contains(denominator) else {
            throw TimingError.invalidMeter("denominator \(denominator) must be a power of two up to 32")
        }
        let groups = grouping ?? Meter.defaultGrouping(numerator: numerator, denominator: denominator)
        guard !groups.isEmpty, groups.allSatisfy({ $0 > 0 }) else {
            throw TimingError.invalidGrouping("groups must be positive: \(groups)")
        }
        guard groups.reduce(0, +) == numerator else {
            throw TimingError.invalidGrouping("groups \(groups) must add up to \(numerator)")
        }
        self.numerator = numerator
        self.denominator = denominator
        self.grouping = groups
    }

    public static let fourFour = try! Meter(4, 4)
    public static let threeFour = try! Meter(3, 4)
    public static let sixEight = try! Meter(6, 8)
    public static let sevenEight = try! Meter(7, 8)

    /// Duration of one meter unit (the denominator note).
    public var unit: NoteValue { NoteValue(Rational(1, Int64(denominator))) }

    /// Length of one bar in whole notes.
    public var barLength: Rational { Rational(Int64(numerator), Int64(denominator)) }

    /// Compound meters (6/8, 9/8, 12/8, …) count in groups of three.
    public var isCompound: Bool {
        denominator >= 8 && numerator > 3 && numerator % 3 == 0
    }

    /// The note value the BPM usually refers to: the dotted note for compound
    /// meters, otherwise the meter unit.
    public var defaultBeatUnit: NoteValue {
        isCompound ? NoteValue(Rational(3, Int64(denominator))) : unit
    }

    /// Unit indices (0-based) at which each group starts.
    public var groupStarts: [Int] {
        var starts: [Int] = []
        var position = 0
        for group in grouping {
            starts.append(position)
            position += group
        }
        return starts
    }

    /// Simple meters count every unit; eighth-based meters group in twos
    /// and threes (compound → all threes, odd → twos ending with a three).
    static func defaultGrouping(numerator: Int, denominator: Int) -> [Int] {
        if denominator < 8 || numerator <= 3 {
            return Array(repeating: 1, count: numerator)
        }
        if numerator % 3 == 0 {
            return Array(repeating: 3, count: numerator / 3)
        }
        if numerator % 2 == 0 {
            return Array(repeating: 2, count: numerator / 2)
        }
        return Array(repeating: 2, count: (numerator - 3) / 2) + [3]
    }

    public var description: String {
        let groups = grouping.allSatisfy { $0 == 1 } ? "" : " (" + grouping.map(String.init).joined(separator: "+") + ")"
        return "\(numerator)/\(denominator)\(groups)"
    }
}
