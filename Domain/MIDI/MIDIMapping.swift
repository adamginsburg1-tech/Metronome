import Foundation

/// Something POCKET can do from a pedal or controller.
public enum MIDIAction: String, Sendable, Hashable, Codable, CaseIterable {
    case playPause, stop, nextSong, previousSong, tapTempo, tempoUp, tempoDown
    case panicRestart, toggleCountIn, toggleGapClick, nextChartPage, previousChartPage
}

/// A control on a MIDI device. Footswitches usually send a note or a CC
/// (127 down, 0 up); some send program changes.
public enum MIDITrigger: Sendable, Hashable, Codable, CustomStringConvertible {
    case note(channel: Int, note: Int)
    case controlChange(channel: Int, controller: Int)
    case programChange(channel: Int, program: Int)

    public var description: String {
        switch self {
        case let .note(c, n): "Note \(n) · ch \(c)"
        case let .controlChange(c, n): "CC \(n) · ch \(c)"
        case let .programChange(c, p): "Program \(p + 1) · ch \(c)"
        }
    }
}

/// Saved per device (plan §08: device-specific MIDI preferences).
public struct MIDIMapping: Sendable, Hashable, Codable {
    /// nil listens on every channel ("omni"); otherwise 1...16.
    public var channel: Int?
    /// Presses closer together than this are ignored (switch bounce, double hits).
    public var debounceMilliseconds: Int
    /// A CC counts as pressed when it rises to this value or above.
    public var ccThreshold: Int
    public private(set) var bindings: [MIDIAction: MIDITrigger]

    public init(channel: Int? = nil, debounceMilliseconds: Int = 120, ccThreshold: Int = 64, bindings: [MIDIAction: MIDITrigger] = [:]) {
        self.channel = channel.map { min(16, max(1, $0)) }
        self.debounceMilliseconds = max(0, debounceMilliseconds)
        self.ccThreshold = min(127, max(1, ccThreshold))
        self.bindings = bindings
    }

    /// Binds `trigger` to `action`. A trigger drives one action only, so it is
    /// removed from any other action first.
    public mutating func bind(_ action: MIDIAction, to trigger: MIDITrigger) {
        for (other, t) in bindings where t == trigger && other != action { bindings[other] = nil }
        bindings[action] = trigger
    }

    public mutating func clear(_ action: MIDIAction) { bindings[action] = nil }
    public mutating func clearAll() { bindings = [:] }

    public func action(for trigger: MIDITrigger) -> MIDIAction? {
        bindings.first { $0.value == trigger }?.key
    }
}

/// What the router did with a message.
public enum MIDIRouteResult: Sendable, Hashable {
    case action(MIDIAction)
    /// Learn mode bound this trigger to the action.
    case learned(MIDIAction, MIDITrigger)
    /// A press that is not bound (show it so the player can see the pedal works).
    case unmapped(MIDITrigger)
}

/// Turns messages into actions: channel filter, press detection (note-on, CC rising
/// through the threshold, program change), debounce per trigger, and learn mode.
public struct MIDIRouter: Sendable {
    public var mapping: MIDIMapping
    public private(set) var learning: MIDIAction?
    private var lastPress: [MIDITrigger: Double] = [:]
    private var ccDown: Set<MIDITrigger> = []

    public init(mapping: MIDIMapping = MIDIMapping()) { self.mapping = mapping }

    /// The next press is bound to `action` (and not acted on).
    public mutating func beginLearn(_ action: MIDIAction) { learning = action }
    public mutating func cancelLearn() { learning = nil }

    /// `time` is in seconds on any steady clock (e.g. the Core MIDI timestamp).
    public mutating func handle(_ message: MIDIMessage, at time: Double) -> MIDIRouteResult? {
        if let channel = message.channel, let wanted = mapping.channel, channel != wanted { return nil }
        let trigger: MIDITrigger
        switch message {
        case let .noteOn(c, n, v) where v > 0:
            trigger = .note(channel: c, note: n)
        case let .controlChange(c, n, v):
            let t = MIDITrigger.controlChange(channel: c, controller: n)
            if v >= mapping.ccThreshold {
                guard !ccDown.contains(t) else { return nil }            // still held
                ccDown.insert(t)
                trigger = t
            } else {
                ccDown.remove(t)
                return nil
            }
        case let .programChange(c, p):
            trigger = .programChange(channel: c, program: p)
        default:
            return nil                                                   // note-offs, real-time
        }
        if let last = lastPress[trigger], (time - last) * 1000 < Double(mapping.debounceMilliseconds) { return nil }
        lastPress[trigger] = time
        if let action = learning {
            mapping.bind(action, to: trigger)
            learning = nil
            return .learned(action, trigger)
        }
        if let action = mapping.action(for: trigger) { return .action(action) }
        return .unmapped(trigger)
    }
}

/// Explicit connect/disconnect feedback (plan §08). Give it the current list of
/// MIDI source names whenever Core MIDI reports a change.
public struct MIDIDeviceMonitor: Sendable {
    public enum Event: Sendable, Hashable {
        case connected(String)
        case disconnected(String)

        /// Copy for the on-screen notice.
        public var message: String {
            switch self {
            case let .connected(name): "\(name) connected. Pedal control is on."
            case let .disconnected(name): "\(name) disconnected. Pedal control is off until it reconnects; use the screen."
            }
        }
    }

    public private(set) var sources: [String] = []

    public init() {}

    public mutating func update(_ current: [String]) -> [Event] {
        let before = Set(sources), now = Set(current)
        let gone = sources.filter { !now.contains($0) }.map(Event.disconnected)
        let new = current.filter { !before.contains($0) }.map(Event.connected)
        sources = current
        return gone + new
    }
}
