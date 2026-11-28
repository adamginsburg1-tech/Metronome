import XCTest
@testable import PocketDomain

/// Transport contract (plan §06, Docs/UX.md › States and J3–J6).
/// 120 BPM at 48 kHz: 24 000 frames per quarter; start delay 0.12 s = 5 760 frames.
final class TransportTests: XCTestCase {
    let sr = 48_000
    let q: Int64 = 24_000
    let delay: Int64 = 5_760

    func makeTransport(countIn: CountInMode = .everyStart, bars: Int = 1, landOn: ChangeBoundary = .step) throws -> TransportController {
        let setup = TransportSetup(pattern: try ClickPattern(meter: .fourFour), tempo: try Tempo(bpm: 120),
                                   countInMode: countIn, countInBars: bars, tempoChangesLandOn: landOn)
        return TransportController(setup: setup, sampleRate: sr)
    }

    /// Start and let the engine come up at `frame`.
    func started(_ t: inout TransportController, at frame: Int64 = 0) {
        XCTAssertEqual(t.start(), [.startAudio])
        XCTAssertEqual(t.state, .preparing(resuming: false))
        XCTAssertEqual(t.audioStarted(atFrame: frame), [])
    }

    func testStartCountsInThenPlays() throws {
        var t = try makeTransport()
        started(&t)
        XCTAssertEqual(t.state, .countIn)
        let batch = try XCTUnwrap(t.schedule(through: delay + 5 * q + 1))
        XCTAssertEqual(batch.clicks.map(\.frame), (0...5).map { delay + Int64($0) * q })
        XCTAssertEqual(batch.clicks.map(\.role), [.countIn, .countIn, .countIn, .countIn, .music, .music])

        XCTAssertNil(t.playhead(atFrame: delay - 1), "nothing sounds before the first click")
        XCTAssertEqual(t.playhead(atFrame: delay + 2 * q), Playhead(bar: 1, isCountIn: true, planBar: -1, elapsedFrames: 0))
        XCTAssertEqual(t.state, .countIn)
        XCTAssertEqual(t.playhead(atFrame: delay + 4 * q + 100), Playhead(bar: 1, isCountIn: false, planBar: 0, elapsedFrames: 100))
        XCTAssertEqual(t.state, .playing)
        XCTAssertEqual(t.playhead(atFrame: delay + 8 * q)?.bar, 2)
    }

    func testScheduleWindowsNeverRepeatOrSkip() throws {
        var whole = try makeTransport(bars: 2)
        started(&whole)
        let all = try XCTUnwrap(whole.schedule(through: 500_000)).clicks

        var chunked = try makeTransport(bars: 2)
        started(&chunked)
        var clicks: [ClickEvent] = []
        var horizon: Int64 = 0
        while horizon < 500_000 {
            horizon = min(500_000, horizon + 4_321)
            clicks += try XCTUnwrap(chunked.schedule(through: horizon)).clicks
        }
        XCTAssertEqual(clicks, all)
        XCTAssertEqual(chunked.scheduledThrough, 500_000)
    }

    func testNothingIsScheduledUnlessRunning() throws {
        var t = try makeTransport()
        XCTAssertNil(t.schedule(through: 100_000))
        t.start()
        XCTAssertNil(t.schedule(through: 100_000), "still waiting for the engine")
    }

    func testPauseKeepsPlaceAndResumeContinuesFromNextBar() throws {
        var t = try makeTransport()
        started(&t)
        let firstGeneration = t.generation
        _ = t.schedule(through: delay + 7 * q)
        // Pause in music bar 0 (bar 1 on screen), half a beat into beat 3.
        let pauseAt = delay + 4 * q + 2 * q + q / 2
        XCTAssertEqual(t.pause(atFrame: pauseAt), [.silence])
        XCTAssertEqual(t.state, .paused)
        XCTAssertNil(t.plan)
        XCTAssertNil(t.schedule(through: 1_000_000))
        XCTAssertGreaterThan(t.generation, firstGeneration, "batches from before the pause are stale")

        // Resume: counts in again (every start), then continues with bar 2.
        XCTAssertEqual(t.resume(), [.startAudio])
        XCTAssertEqual(t.state, .preparing(resuming: true))
        let resumeAt: Int64 = 1_000_000
        t.audioStarted(atFrame: resumeAt)
        XCTAssertEqual(t.state, .countIn)
        let music = resumeAt + delay + 4 * q
        let head = try XCTUnwrap(t.playhead(atFrame: music + 10))
        XCTAssertEqual(head.bar, 2)
        XCTAssertFalse(head.isCountIn)
        XCTAssertEqual(head.elapsedFrames, (pauseAt - (delay + 4 * q)) + 10, "elapsed time excludes the pause and count-ins")
    }

    func testFirstStartOnlySkipsCountInOnResumeAndRestart() throws {
        var t = try makeTransport(countIn: .firstStartOnly)
        started(&t)
        XCTAssertEqual(t.countInBars, 1)
        t.pause(atFrame: delay + q)
        t.resume()
        t.audioStarted(atFrame: 200_000)
        XCTAssertEqual(t.state, .playing)
        XCTAssertEqual(t.countInBars, 0)
        t.stop()
        started(&t, at: 400_000)
        XCTAssertEqual(t.state, .playing, "only the first Start after opening POCKET counts in")
    }

    func testCountInOffAndPauseDuringCountIn() throws {
        var off = try makeTransport(countIn: .off)
        started(&off)
        XCTAssertEqual(off.state, .playing)
        XCTAssertEqual(off.schedule(through: delay + 1)?.clicks.first?.role, .music)

        var t = try makeTransport(bars: 2)
        started(&t)
        t.pause(atFrame: delay + 5 * q) // second count-in bar
        t.resume()
        t.audioStarted(atFrame: 300_000)
        XCTAssertEqual(t.playhead(atFrame: 300_000 + delay + 8 * q)?.bar, 1, "pausing in the count-in doesn't advance the bar count")
    }

    func testStopForgetsThePlace() throws {
        var t = try makeTransport(countIn: .off)
        started(&t)
        _ = t.schedule(through: delay + 9 * q)
        XCTAssertEqual(t.playhead(atFrame: delay + 9 * q)?.bar, 3)
        XCTAssertEqual(t.stop(), [.silence, .releaseAudio])
        XCTAssertEqual(t.state, .idle)
        XCTAssertEqual(t.stop(), [], "Stop from Ready does nothing")
        started(&t, at: 1_000_000)
        XCTAssertEqual(t.playhead(atFrame: 1_000_000 + delay)?.bar, 1)
        XCTAssertEqual(t.playhead(atFrame: 1_000_000 + delay)?.elapsedFrames, 0)
    }

    func testStopFromPausedReturnsToReady() throws {
        var t = try makeTransport()
        started(&t)
        t.pause(atFrame: delay)
        XCTAssertEqual(t.stop(), [.silence, .releaseAudio])
        XCTAssertEqual(t.state, .idle)
    }

    func testTempoChangeLandsOnNextUnscheduledClickAndCombines() throws {
        var t = try makeTransport(countIn: .off)
        started(&t)
        let before = try XCTUnwrap(t.schedule(through: delay + q + 1)).clicks // clicks 0 and 1
        t.setTempo(try Tempo(bpm: 100))
        t.setTempo(try Tempo(bpm: 60))
        XCTAssertEqual(t.pending?.tempo, try Tempo(bpm: 60))
        XCTAssertNil(t.queued)

        let after = try XCTUnwrap(t.schedule(through: delay + q + 4 * 48_000)).clicks
        // Click 2 is the first not yet scheduled: it lands there, at 60 BPM (48 000 apart).
        XCTAssertEqual(after.map(\.frame), (0..<4).map { delay + 2 * q + Int64($0) * 48_000 })
        XCTAssertNil(t.pending)
        let queued = try XCTUnwrap(t.queued)
        XCTAssertEqual(queued.position, BarPosition(bar: 0, grid: 2))
        XCTAssertEqual(queued.frame, delay + 2 * q)
        XCTAssertEqual(queued.boundary, .step)
        XCTAssertEqual(t.plan?.events(in: 0..<(delay + q + 1)), before, "scheduled clicks never move")

        // The note switches from "Next beat" to "Now 60 BPM" when it sounds, for one bar.
        t.playhead(atFrame: delay + 2 * q)
        XCTAssertNil(t.queued)
        XCTAssertEqual(t.landed?.tempo, try Tempo(bpm: 60))
        t.playhead(atFrame: delay + 2 * q + 2 * 48_000)
        XCTAssertNil(t.landed)
    }

    func testTempoChangeOnNextBar() throws {
        var t = try makeTransport(countIn: .off, landOn: .bar)
        started(&t)
        _ = t.schedule(through: delay + 1)
        t.setTempo(try Tempo(bpm: 60))
        let clicks = try XCTUnwrap(t.schedule(through: delay + 4 * q + 48_000 + 1)).clicks
        XCTAssertEqual(clicks.map(\.frame), [delay + q, delay + 2 * q, delay + 3 * q, delay + 4 * q, delay + 4 * q + 48_000])
        XCTAssertEqual(t.queued?.position, BarPosition(bar: 1))
    }

    func testTempoChangeWhilePausedOnlyChangesSetup() throws {
        var t = try makeTransport(countIn: .off)
        started(&t)
        t.pause(atFrame: delay)
        t.setTempo(try Tempo(bpm: 60))
        XCTAssertNil(t.pending)
        t.resume()
        t.audioStarted(atFrame: 0)
        XCTAssertEqual(t.schedule(through: delay + 48_000 + 1)?.clicks.map(\.frame), [delay, delay + 48_000])
    }

    func testMeterChangeWaitsForBarLineButAccentsLandNow() throws {
        var t = try makeTransport(countIn: .off)
        started(&t)
        _ = t.schedule(through: delay + 1)

        t.setPattern(try ClickPattern(meter: .threeFour))
        let bar = try XCTUnwrap(t.schedule(through: delay + 7 * q + 1)).clicks
        XCTAssertEqual(t.queued?.position, BarPosition(bar: 1))
        XCTAssertEqual(t.queued?.boundary, .bar)
        XCTAssertEqual(bar.map(\.level), [.normal, .normal, .normal, .downbeat, .normal, .normal, .downbeat])

        // Accent-only change in 3/4: the next click uses it, mid-bar.
        t.setPattern(try ClickPattern(meter: .threeFour, accents: [.downbeat, .muted, .group]))
        let next = try XCTUnwrap(t.schedule(through: delay + 9 * q + 1)).clicks
        XCTAssertEqual(t.queued?.position, BarPosition(bar: 2, grid: 1))
        XCTAssertEqual(t.queued?.boundary, .step)
        XCTAssertEqual(next.map(\.frame), [delay + 9 * q], "beat 2 is now silent")
        XCTAssertEqual(next.map(\.level), [.group], "beat 3 is a group accent")
    }

    func testPatternChangeDuringCountInStartsWithTheMusic() throws {
        var t = try makeTransport()
        started(&t)
        _ = t.schedule(through: delay + 1)
        t.setPattern(try ClickPattern(meter: .fourFour, subdivision: 2))
        let clicks = try XCTUnwrap(t.schedule(through: delay + 5 * q)).clicks
        XCTAssertEqual(clicks.filter { $0.role == .countIn }.count, 3, "the count-in keeps its quarter notes")
        XCTAssertEqual(clicks.filter { $0.role == .music }.map(\.frame), [delay + 4 * q, delay + 4 * q + q / 2])
    }

    func testInterruptionPausesWithMessageAndNeverResumes() throws {
        var t = try makeTransport()
        started(&t)
        XCTAssertEqual(t.interrupted(by: .audioTakenOver, atFrame: delay + q), [.silence])
        XCTAssertEqual(t.state, .paused)
        XCTAssertEqual(t.notice, .audioTakenOver)
        XCTAssertTrue(t.notice!.message.hasPrefix("Click paused."))

        XCTAssertEqual(t.interrupted(by: .outputChanged, atFrame: delay + 2 * q), [], "an interruption while paused changes nothing")
        XCTAssertEqual(t.notice, .audioTakenOver)
        XCTAssertEqual(t.state, .paused)

        t.resume()
        XCTAssertNil(t.notice, "Resume clears the message")
    }

    func testInterruptionWhileStartingReturnsToUsableState() throws {
        var t = try makeTransport()
        t.start()
        XCTAssertEqual(t.interrupted(by: .background, atFrame: 0), [.releaseAudio])
        XCTAssertEqual(t.state, .idle)
        XCTAssertEqual(t.notice, .stoppedInBackground)
        XCTAssertEqual(t.audioStarted(atFrame: 0), [], "a late engine start is ignored")
        XCTAssertNil(t.plan)
    }

    func testFailedStartAndFailedResume() throws {
        var t = try makeTransport()
        t.start()
        XCTAssertEqual(t.audioFailed(), [.releaseAudio])
        XCTAssertEqual(t.state, .idle)
        XCTAssertEqual(t.notice, .cantStart)
        XCTAssertEqual(t.start(), [.startAudio], "retry is just Start")
        XCTAssertNil(t.notice)
        t.audioStarted(atFrame: 0)

        t.pause(atFrame: delay + 5 * q)
        t.resume()
        XCTAssertEqual(t.audioFailed(), [])
        XCTAssertEqual(t.state, .paused, "a failed resume keeps your place")
        XCTAssertEqual(t.notice, .cantStart)
    }

    func testStoppedBySystemNeedsDeliberateRecovery() throws {
        var t = try makeTransport()
        started(&t)
        XCTAssertEqual(t.audioStopped(), [.silence, .releaseAudio])
        XCTAssertEqual(t.state, .interrupted)
        XCTAssertFalse(t.state.isActive)
        XCTAssertNil(t.schedule(through: 100_000))
        XCTAssertEqual(t.resume(), [], "Resume doesn't apply; only Start or Dismiss")
        t.dismissNotice()
        XCTAssertEqual(t.state, .idle)

        started(&t)
        t.audioStopped()
        XCTAssertEqual(t.start(), [.startAudio])
        XCTAssertNil(t.notice)
    }

    func testSkippedClicks() throws {
        var t = try makeTransport(countIn: .off)
        started(&t)
        XCTAssertEqual(t.skippedClicks(2, inBackground: false, atFrame: delay), [])
        XCTAssertEqual(t.state, .playing, "on screen it keeps playing")
        XCTAssertEqual(t.notice, .timingHiccup(skipped: 2))
        XCTAssertFalse(t.notice!.isBlocking)

        XCTAssertEqual(t.skippedClicks(6, inBackground: true, atFrame: delay + q), [.silence])
        XCTAssertEqual(t.state, .paused)
        XCTAssertEqual(t.notice?.message, "Click paused: POCKET skipped 6 clicks while in the background. Press Resume to continue.")
    }

    func testNudgeClampsToSupportedRange() throws {
        var t = try makeTransport()
        t.nudgeTempo(by: 5)
        XCTAssertEqual(t.setup.tempo.bpm, Rational(125))
        t.setTempo(try Tempo(bpm: 298))
        t.nudgeTempo(by: 5)
        XCTAssertEqual(t.setup.tempo.bpm, Rational(300))
        t.setTempo(try Tempo(bpm: 21.5))
        t.nudgeTempo(by: -5)
        XCTAssertEqual(t.setup.tempo.bpm, Rational(20))
    }

    func testPedalActions() throws {
        var t = try makeTransport()
        XCTAssertEqual(t.perform(.playPause, atFrame: 0), [.startAudio])
        t.audioStarted(atFrame: 0)
        XCTAssertEqual(t.perform(.playPause, atFrame: delay), [.silence])
        XCTAssertEqual(t.state, .paused)
        XCTAssertEqual(t.perform(.playPause, atFrame: 0), [.startAudio])
        XCTAssertEqual(t.state, .preparing(resuming: true))
        t.audioStarted(atFrame: 0)

        XCTAssertEqual(t.perform(.panicRestart, atFrame: delay), [.silence, .startAudio])
        XCTAssertEqual(t.state, .preparing(resuming: false))
        t.audioStarted(atFrame: 0)

        t.perform(.tempoUp, atFrame: 0)
        XCTAssertEqual(t.pending?.tempo?.bpm, Rational(121))
        t.perform(.toggleCountIn, atFrame: 0)
        XCTAssertEqual(t.setup.countInMode, .off)
        XCTAssertNil(t.perform(.nextSong, atFrame: 0), "songs are the app's job")
        XCTAssertEqual(t.perform(.stop, atFrame: 0), [.silence, .releaseAudio])
    }

    func testTapTempo() throws {
        var tap = TapTempo()
        XCTAssertEqual(tap.tap(at: 10.0), .tapAgain)
        XCTAssertEqual(tap.tap(at: 10.5), .tempo(try Tempo(bpm: 120)))
        XCTAssertEqual(tap.tap(at: 11.0), .tempo(try Tempo(bpm: 120)))
        // Averages up to the last four gaps: 0.5, 0.5, 0.6, 0.6 → 0.55 s → 109 BPM.
        _ = tap.tap(at: 11.6)
        XCTAssertEqual(tap.tap(at: 12.2), .tempo(try Tempo(bpm: 109)))
        // More than 2 s later starts over.
        XCTAssertEqual(tap.tap(at: 14.5), .tapAgain)
        XCTAssertEqual(tap.tap(at: 14.6), .tempo(try Tempo(bpm: 300)), "clamped to 300")
    }
}
