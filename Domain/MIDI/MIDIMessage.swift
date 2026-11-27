/// MIDI input for stage control (plan §08: "Core MIDI mapping with learn/clear,
/// debounce, channel filtering and explicit disconnect feedback").
///
/// This file and its siblings are platform-independent: the iPad app feeds raw
/// bytes from Core MIDI into `MIDIParser` and acts on what `MIDIRouter` returns.

/// A channel message or system real-time byte. Channels are 1...16.
public enum MIDIMessage: Sendable, Hashable {
    case noteOn(channel: Int, note: Int, velocity: Int)
    case noteOff(channel: Int, note: Int, velocity: Int)
    case controlChange(channel: Int, controller: Int, value: Int)
    case programChange(channel: Int, program: Int)
    /// Timing clock, start, continue, stop, active sensing, reset (0xF8...0xFF).
    case realTime(UInt8)

    public var channel: Int? {
        switch self {
        case let .noteOn(c, _, _), let .noteOff(c, _, _), let .controlChange(c, _, _), let .programChange(c, _): c
        case .realTime: nil
        }
    }
}

/// Turns a byte stream into messages. Handles running status, real-time bytes
/// interleaved anywhere, and skips SysEx and messages POCKET doesn't use
/// (aftertouch, pitch bend, system common). Note-on with velocity 0 is a note-off.
public struct MIDIParser: Sendable {
    private var status: UInt8 = 0
    private var data: [UInt8] = []
    private var inSysEx = false

    public init() {}

    public mutating func parse(_ bytes: [UInt8]) -> [MIDIMessage] {
        var out: [MIDIMessage] = []
        for byte in bytes {
            if byte >= 0xF8 { out.append(.realTime(byte)); continue }      // never breaks running status
            if byte == 0xF0 { inSysEx = true; status = 0; data = []; continue }
            if byte == 0xF7 { inSysEx = false; continue }
            if inSysEx { continue }
            if byte & 0x80 != 0 {
                // System common cancels running status; channel status starts a message.
                status = byte < 0xF0 ? byte : 0
                data = []
                continue
            }
            guard status != 0 else { continue }                          // stray data byte
            data.append(byte)
            let kind = status & 0xF0, channel = Int(status & 0x0F) + 1
            let needed = (kind == 0xC0 || kind == 0xD0) ? 1 : 2
            guard data.count == needed else { continue }
            defer { data = [] }                                          // keep status (running status)
            switch kind {
            case 0x90: out.append(data[1] == 0 ? .noteOff(channel: channel, note: Int(data[0]), velocity: 0)
                                               : .noteOn(channel: channel, note: Int(data[0]), velocity: Int(data[1])))
            case 0x80: out.append(.noteOff(channel: channel, note: Int(data[0]), velocity: Int(data[1])))
            case 0xB0: out.append(.controlChange(channel: channel, controller: Int(data[0]), value: Int(data[1])))
            case 0xC0: out.append(.programChange(channel: channel, program: Int(data[0])))
            default: break                                               // aftertouch, pitch bend
            }
        }
        return out
    }
}
