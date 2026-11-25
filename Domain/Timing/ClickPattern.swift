/// How strongly a click sounds. The audio layer maps levels to sounds/gains.
public enum AccentLevel: Int, Sendable, Hashable, Comparable, CaseIterable, CustomStringConvertible {
    /// Not sounded. The clock keeps running (used for gap training and
    /// for silencing units, e.g. counting 6/8 in two).
    case muted = 0
    /// Subdivision clicks between meter units.
    case subdivision = 1
    /// An ordinary meter unit.
    case normal = 2
    /// Start of a group (e.g. the 3rd and 5th eighth in 7/8 = 2+2+3).
    case group = 3
    /// First unit of the bar.
    case downbeat = 4

    public static func < (lhs: AccentLevel, rhs: AccentLevel) -> Bool { lhs.rawValue < rhs.rawValue }

    public var description: String {
        switch self {
        case .muted: "muted"
        case .subdivision: "sub"
        case .normal: "normal"
        case .group: "group"
        case .downbeat: "downbeat"
        }
    }
}

/// Tempo in beats per minute, where a "beat" is an explicit note value
/// (e.g. dotted quarter = 60 in 6/8).
public struct Tempo: Sendable, Hashable, CustomStringConvertible {
    public static let supportedRange: ClosedRange<Rational> = Rational(20)...Rational(300)

    public let bpm: Rational
    public let beatUnit: NoteValue

    public init(bpm: Rational, beatUnit: NoteValue = .quarter) throws {
        guard Tempo.supportedRange.contains(bpm) else {
            throw TimingError.tempoOutOfRange(bpm)
        }
        self.bpm = bpm
        self.beatUnit = beatUnit
    }

    /// Convenience for UI values; BPM is stored to 0.01 precision.
    public init(bpm: Double, beatUnit: NoteValue = .quarter) throws {
        guard bpm.isFinite else { throw TimingError.tempoOutOfRange(.zero) }
        try self.init(bpm: Rational.approximating(bpm, denominator: 100), beatUnit: beatUnit)
    }

    /// Exact number of audio frames in one whole note.
    public func framesPerWholeNote(sampleRate: Int) -> Rational {
        Rational(Int64(60 * sampleRate)) / (bpm * beatUnit.wholeNotes)
    }

    public var description: String { "\(bpm.doubleValue) BPM (\(beatUnit))" }
}

/// What sounds inside each bar: meter, subdivision and accent map.
///
/// The grid is `meter.numerator × subdivision` evenly spaced events per bar.
/// `subdivision` splits each meter unit into equal parts (2 = duple,
/// 3 = triplet, 5 = quintuplet, …). Accents are per meter unit and are
/// independent of the subdivision.
public struct ClickPattern: Sendable, Hashable {
    public static let supportedSubdivisions: ClosedRange<Int> = 1...8

    public let meter: Meter
    public let subdivision: Int
    public let accents: [AccentLevel]
    /// Level for clicks between units. `.muted` turns subdivisions off
    /// without changing the grid.
    public let subdivisionLevel: AccentLevel

    public init(
        meter: Meter,
        subdivision: Int = 1,
        accents: [AccentLevel]? = nil,
        subdivisionLevel: AccentLevel = .subdivision
    ) throws {
        guard ClickPattern.supportedSubdivisions.contains(subdivision) else {
            throw TimingError.invalidSubdivision(subdivision)
        }
        let map = accents ?? ClickPattern.defaultAccents(for: meter)
        guard map.count == meter.numerator else {
            throw TimingError.invalidAccents("expected \(meter.numerator) accents, got \(map.count)")
        }
        self.meter = meter
        self.subdivision = subdivision
        self.accents = map
        self.subdivisionLevel = subdivisionLevel
    }

    /// Downbeat on unit 0, group accent on other group starts (when units are
    /// actually grouped), normal elsewhere.
    public static func defaultAccents(for meter: Meter) -> [AccentLevel] {
        var map = Array(repeating: AccentLevel.normal, count: meter.numerator)
        if meter.grouping.contains(where: { $0 > 1 }) {
            for start in meter.groupStarts { map[start] = .group }
        }
        map[0] = .downbeat
        return map
    }

    public var eventsPerBar: Int { meter.numerator * subdivision }

    /// Grid step in whole notes.
    public var stepLength: Rational { meter.unit.wholeNotes / Rational(subdivision) }

    /// Level of grid event `index` (0..<eventsPerBar).
    public func level(atGridIndex index: Int) -> AccentLevel {
        index % subdivision == 0 ? accents[index / subdivision] : subdivisionLevel
    }

    /// Same meter and accents, no subdivisions — used for count-ins.
    public var unitsOnly: ClickPattern {
        try! ClickPattern(meter: meter, subdivision: 1, accents: accents)
    }
}
