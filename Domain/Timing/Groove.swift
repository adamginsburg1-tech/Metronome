/// A drum groove (plan §08, M3): a short pattern on its own fine grid that plays
/// with the click on the same clock. Mirrors `grooveEventsIn` in web/src/timing.js.
///
/// `stepsPerUnit` splits each meter unit (4 = sixteenths in /4 meters, 2 = sixteenths
/// in /8 meters). Each lane holds one level per step: 0 rest, 1 ghost, 2 hit, 3 accent.
/// Lanes shorter or longer than the bar wrap per bar.
public struct Groove: Sendable, Hashable {
    /// Lane the web player uses to drive its playhead; it never sounds and never
    /// affects swing pairing.
    public static let playheadLane = "_step"

    public let stepsPerUnit: Int
    public let lanes: [String: [Int]]

    public init(stepsPerUnit: Int, lanes: [String: [Int]]) throws {
        guard (1...16).contains(stepsPerUnit) else { throw TimingError.invalidPlan("groove steps per unit \(stepsPerUnit) must be 1...16") }
        guard lanes.values.allSatisfy({ $0.allSatisfy { (0...3).contains($0) } }) else {
            throw TimingError.invalidPlan("groove levels must be 0...3")
        }
        self.stepsPerUnit = stepsPerUnit
        self.lanes = lanes
    }

    /// Swing pairs belong to the groove: any note on an odd step pairs sixteenths
    /// (2 steps); otherwise eighths (4 steps). The playhead lane is ignored (D-035).
    public var pairSteps: Int {
        let odd = lanes.contains { id, steps in
            id != Groove.playheadLane && steps.indices.contains { $0 % 2 == 1 && steps[$0] > 0 }
        }
        return odd ? 2 : 4
    }
}

/// One drum hit.
public struct GrooveHit: Sendable, Hashable {
    public let frame: Int64
    public let bar: Int
    /// Step within the groove bar.
    public let step: Int
    public let lane: String
    public let level: Int
    public let segmentIndex: Int
}
