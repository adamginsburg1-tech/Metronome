import XCTest
@testable import PocketDomain

final class MIDITests: XCTestCase {
    func testParserHandlesRunningStatusRealTimeAndSysEx() {
        var p = MIDIParser()
        // Note on ch1 60 vel 100, running status note 62 vel 0 (= off), clock in the middle,
        // SysEx skipped, CC 64 on ch 2, program 5 on ch 16, pitch bend ignored.
        let bytes: [UInt8] = [0x90, 60, 100, 62, 0xF8, 0, 0xF0, 0x7E, 0x01, 0xF7, 0xB1, 64, 127, 0xCF, 5, 0xE0, 0, 64]
        XCTAssertEqual(p.parse(bytes), [
            .noteOn(channel: 1, note: 60, velocity: 100),
            .realTime(0xF8),
            .noteOff(channel: 1, note: 62, velocity: 0),
            .controlChange(channel: 2, controller: 64, value: 127),
            .programChange(channel: 16, program: 5),
        ])
    }

    func testParserKeepsStateAcrossPackets() {
        var p = MIDIParser()
        XCTAssertEqual(p.parse([0xB0, 80]), [])
        XCTAssertEqual(p.parse([127, 80, 0]), [.controlChange(channel: 1, controller: 80, value: 127), .controlChange(channel: 1, controller: 80, value: 0)])
    }

    func testLearnBindsTheNextPressAndMovesTriggers() {
        var r = MIDIRouter()
        r.beginLearn(.nextSong)
        XCTAssertEqual(r.handle(.noteOn(channel: 1, note: 60, velocity: 90), at: 0), .learned(.nextSong, .note(channel: 1, note: 60)))
        XCTAssertNil(r.learning)
        XCTAssertEqual(r.handle(.noteOn(channel: 1, note: 60, velocity: 90), at: 1), .action(.nextSong))
        // Same pedal learned for another action: it leaves nextSong.
        r.beginLearn(.playPause)
        _ = r.handle(.noteOn(channel: 1, note: 60, velocity: 90), at: 2)
        XCTAssertNil(r.mapping.bindings[.nextSong])
        XCTAssertEqual(r.handle(.noteOn(channel: 1, note: 60, velocity: 90), at: 3), .action(.playPause))
        r.mapping.clear(.playPause)
        XCTAssertEqual(r.handle(.noteOn(channel: 1, note: 60, velocity: 90), at: 4), .unmapped(.note(channel: 1, note: 60)))
    }

    func testControlChangeFiresOnceOnTheWayUp() {
        var r = MIDIRouter(mapping: MIDIMapping(bindings: [.stop: .controlChange(channel: 1, controller: 80)]))
        XCTAssertEqual(r.handle(.controlChange(channel: 1, controller: 80, value: 127), at: 0), .action(.stop))
        XCTAssertNil(r.handle(.controlChange(channel: 1, controller: 80, value: 127), at: 0.5))    // still down
        XCTAssertNil(r.handle(.controlChange(channel: 1, controller: 80, value: 0), at: 0.6))      // release
        XCTAssertEqual(r.handle(.controlChange(channel: 1, controller: 80, value: 100), at: 1.0), .action(.stop))
    }

    func testDebounceAndChannelFilter() {
        var r = MIDIRouter(mapping: MIDIMapping(channel: 3, debounceMilliseconds: 120, bindings: [.tapTempo: .note(channel: 3, note: 36)]))
        XCTAssertNil(r.handle(.noteOn(channel: 1, note: 36, velocity: 100), at: 0))                 // other channel
        XCTAssertEqual(r.handle(.noteOn(channel: 3, note: 36, velocity: 100), at: 0), .action(.tapTempo))
        XCTAssertNil(r.handle(.noteOn(channel: 3, note: 36, velocity: 100), at: 0.05))              // bounce
        XCTAssertEqual(r.handle(.noteOn(channel: 3, note: 36, velocity: 100), at: 0.2), .action(.tapTempo))
        XCTAssertNil(r.handle(.noteOff(channel: 3, note: 36, velocity: 0), at: 0.3))
        XCTAssertNil(r.handle(.realTime(0xF8), at: 0.3))
    }

    func testMappingSurvivesSavingAndLoading() throws {
        var m = MIDIMapping(channel: 2, debounceMilliseconds: 80)
        m.bind(.nextChartPage, to: .controlChange(channel: 2, controller: 81))
        m.bind(.previousSong, to: .programChange(channel: 2, program: 0))
        let decoded = try JSONDecoder().decode(MIDIMapping.self, from: JSONEncoder().encode(m))
        XCTAssertEqual(decoded, m)
        XCTAssertEqual(MIDITrigger.programChange(channel: 2, program: 0).description, "Program 1 · ch 2")
    }

    func testDeviceMonitorReportsConnectAndDisconnect() {
        var d = MIDIDeviceMonitor()
        XCTAssertEqual(d.update(["Pedal A"]), [.connected("Pedal A")])
        XCTAssertEqual(d.update(["Pedal A"]), [])
        XCTAssertEqual(d.update(["Keys"]), [.disconnected("Pedal A"), .connected("Keys")])
        XCTAssertEqual(MIDIDeviceMonitor.Event.disconnected("Pedal A").message, "Pedal A disconnected. Pedal control is off until it reconnects; use the screen.")
    }
}
