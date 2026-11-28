import Foundation

// Transport contract (plan §06, Docs/UX.md › States):
// idle → preparing → count-in → playing ↔ paused → idle. System interruptions
// pause and keep the place; nothing ever resumes on its own. A failed start
// returns to a usable state with a reason. "Stopped by the system" leaves only
// by Start or Dismiss.
//
// The controller is a pure value type: it never touches audio. The app feeds it
// user commands, system events and the audio clock (in frames); it answers with
// effects for the audio layer and click batches tagged with a generation ID.
// The audio layer drops any batch whose generation is no longer current, so a
// stop, pause or restart can never leave a stray click behind.

/// When the count-in plays (UX J6).
public enum CountInMode: String, Sendable, Hashable, Codable, CaseIterable {
    /// Every Start, including Resume (default).
    case everyStart
    /// Only the first Start after opening POCKET.
    case firstStartOnly
    case off
}

/// Everything Start needs: the last-used setup (UX J1).
public struct TransportSetup: Sendable, Hashable {
    public var pattern: ClickPattern
    public var tempo: Tempo
    public var countInMode: CountInMode
    /// 1 or 2 bars.
    public var countInBars: Int
    public var gaps: GapPattern
    /// Where tempo changes land while playing (`.step` = "immediately", the default).
    public var tempoChangesLandOn: ChangeBoundary

    public init(
        pattern: ClickPattern,
        tempo: Tempo,
        countInMode: CountInMode = .everyStart,
        countInBars: Int = 1,
        gaps: GapPattern = .off,
        tempoChangesLandOn: ChangeBoundary = .step
    ) {
        self.pattern = pattern
        self.tempo = tempo
        self.countInMode = countInMode
        self.countInBars = min(2, max(1, countInBars))
        self.gaps = gaps
        self.tempoChangesLandOn = tempoChangesLandOn
    }

    /// First launch ever: 120 BPM, 4/4, no subdivision, 1-bar count-in (UX O-2).
    public static var firstLaunch: TransportSetup {
        // Both values are valid constants, so these cannot throw.
        TransportSetup(pattern: try! ClickPattern(meter: .fourFour), tempo: try! Tempo(bpm: 120))
    }
}

public enum TransportState: Sendable, Hashable {
    /// Ready: nothing scheduled.
    case idle
    /// Start or Resume was pressed; waiting for the audio engine.
    case preparing(resuming: Bool)
    case countIn
    case playing
    /// Place kept (bar number and elapsed time); only Resume or Stop leave.
    case paused
    /// Stopped by the system; only Start or Dismiss leave.
    case interrupted

    /// Count-in or playing: clicks are sounding.
    public var isRunning: Bool { self == .countIn || self == .playing }
    /// Anything but Ready: controls such as the workspace switch stay locked.
    public var isActive: Bool { self != .idle && self != .interrupted }
}

/// What the system did to playback.
public enum TransportInterruption: Sendable, Hashable {
    /// A call, Siri, an alarm or another app took the audio session.
    case audioTakenOver
    /// Headphones unplugged, Bluetooth disconnected or switched.
    case outputChanged
    /// The system stopped the sound while POCKET was in the background.
    case background
}

/// The message bar (Docs/UX.md › Messages). Copy lives here so every platform says the same.
public enum TransportNotice: Sendable, Hashable {
    case audioTakenOver
    case outputChanged
    case stoppedInBackground
    case fellBehindInBackground(skipped: Int)
    case cantStart
    case timingHiccup(skipped: Int)
    case audioStopped

    public var message: String {
        switch self {
        case .audioTakenOver:
            "Click paused. A call or another app took over the sound. Press Resume when you're ready."
        case .outputChanged:
            "Click paused because the sound output changed. Check where it will play, then press Resume."
        case .stoppedInBackground:
            "Click paused while POCKET was in the background. Press Resume to continue."
        case let .fellBehindInBackground(n):
            "Click paused: POCKET skipped \(n) \(n == 1 ? "click" : "clicks") while in the background. Press Resume to continue."
        case .cantStart:
            "No sound yet. Check the volume and that the iPad isn't muted, then press Start."
        case let .timingHiccup(n):
            "Timing hiccup: \(n) \(n == 1 ? "click was" : "clicks were") skipped. Close other apps if it happens again."
        case .audioStopped:
            "Click stopped. The sound stopped working. Press Start to try again."
        }
    }

    /// Non-blocking notices fade on their own (after about 5 s) and never replace a blocking one.
    public var isBlocking: Bool {
        if case .timingHiccup = self { return false }
        return true
    }
}

/// What the audio layer must do now.
public enum TransportEffect: Sendable, Hashable {
    /// Activate the audio session and start the engine, then call `audioStarted(atFrame:)`
    /// (or `audioFailed()`).
    case startAudio
    /// Stop every sounding and scheduled click at once (no trailing click).
    case silence
    /// Playback is over: the session may be deactivated, keep-awake released.
    case releaseAudio
}

/// A change made while playing that has not been placed on the timeline yet.
public struct PendingChange: Sendable, Hashable {
    public var tempo: Tempo?
    public var pattern: ClickPattern?
}

/// A change placed on the timeline: it sounds from `frame` on.
public struct QueuedChange: Sendable, Hashable {
    public let position: BarPosition
    public let frame: Int64
    public let tempo: Tempo?
    public let pattern: ClickPattern?
    /// Where it was allowed to land (`.step`, `.beat` or `.bar`).
    public let boundary: ChangeBoundary
}

/// Clicks for one scheduling window. Drop it if `generation` is no longer current.
public struct ClickBatch: Sendable, Hashable {
    public let generation: Int
    public let frames: Range<Int64>
    public let clicks: [ClickEvent]
}

/// What the position readout shows.
public struct Playhead: Sendable, Hashable {
    /// 1-based. During the count-in: count-in bar ("Count-in 1"); otherwise the
    /// bar number since Start, continuing across Pause/Resume.
    public let bar: Int
    public let isCountIn: Bool
    /// Bar within the current plan (count-in bars negative), for grooves and gaps.
    public let planBar: Int
    /// Playing time since Start, excluding pauses and count-ins before music.
    public let elapsedFrames: Int64
}

public struct TransportController: Sendable {
    public let sampleRate: Int
    /// First click this long after the engine starts (web test: 0.12 s).
    public let startDelayFrames: Int64

    public private(set) var state: TransportState = .idle
    public private(set) var setup: TransportSetup
    public private(set) var plan: PlaybackPlan?
    /// Bumped on every start, pause and stop. Batches from older generations are stale.
    public private(set) var generation = 0
    /// Frames before this are already handed to the audio layer.
    public private(set) var scheduledThrough: Int64 = 0
    public private(set) var pending: PendingChange?
    public private(set) var queued: QueuedChange?
    /// The change that landed most recently; shown as "Now 117 BPM" for one bar.
    public private(set) var landed: QueuedChange?
    public private(set) var notice: TransportNotice?
    /// Count-in bars in the current run.
    public private(set) var countInBars = 0

    /// Music bars completed in earlier runs since Start (Resume continues the count).
    private var barOffset = 0
    private var elapsedBefore: Int64 = 0
    private var hasStarted = false
    private var lastPlanBar: Int?

    public init(setup: TransportSetup = .firstLaunch, sampleRate: Int, startDelaySeconds: Double = 0.12) {
        self.setup = setup
        self.sampleRate = sampleRate
        self.startDelayFrames = Int64((startDelaySeconds * Double(sampleRate)).rounded())
    }

    // MARK: Transport commands

    /// Start (from Ready or after a system stop) or Resume (from Paused).
    @discardableResult
    public mutating func start() -> [TransportEffect] {
        switch state {
        case .idle, .interrupted:
            notice = nil
            state = .preparing(resuming: false)
            return [.startAudio]
        case .paused:
            return resume()
        case .preparing, .countIn, .playing:
            return []
        }
    }

    @discardableResult
    public mutating func resume() -> [TransportEffect] {
        guard state == .paused else { return [] }
        notice = nil
        state = .preparing(resuming: true)
        return [.startAudio]
    }

    /// The engine is running; `now` is its current frame. Builds the plan and starts the clock.
    @discardableResult
    public mutating func audioStarted(atFrame now: Int64) -> [TransportEffect] {
        guard case let .preparing(resuming) = state else { return [] }
        let bars: Int = switch setup.countInMode {
        case .off: 0
        case .everyStart: setup.countInBars
        case .firstStartOnly: (resuming || hasStarted) ? 0 : setup.countInBars
        }
        let start = now + startDelayFrames
        do {
            plan = try PlaybackPlan.click(
                pattern: setup.pattern, tempo: setup.tempo, countInBars: bars,
                sampleRate: sampleRate, startFrame: start, gaps: setup.gaps
            )
        } catch {
            return audioFailed()
        }
        generation += 1
        scheduledThrough = start
        countInBars = bars
        pending = nil
        queued = nil
        landed = nil
        lastPlanBar = nil
        if !resuming {
            barOffset = 0
            elapsedBefore = 0
        }
        hasStarted = true
        state = bars > 0 ? .countIn : .playing
        return []
    }

    /// The engine would not start. Back to a usable state with the reason (plan §06).
    @discardableResult
    public mutating func audioFailed() -> [TransportEffect] {
        guard case let .preparing(resuming) = state else { return [] }
        state = resuming ? .paused : .idle
        notice = .cantStart
        return resuming ? [] : [.releaseAudio]
    }

    /// Silence now, keep the place.
    @discardableResult
    public mutating func pause(atFrame now: Int64) -> [TransportEffect] {
        guard state.isRunning else { return [] }
        _ = playhead(atFrame: now)
        if let bar = lastPlanBar, bar >= 0 { barOffset += bar + 1 }
        elapsedBefore += musicFrames(until: now)
        endRun()
        state = .paused
        return [.silence]
    }

    /// Silence now and forget the place. The next Start begins again at bar 1.
    @discardableResult
    public mutating func stop() -> [TransportEffect] {
        switch state {
        case .idle:
            return []
        case .interrupted:
            dismissNotice()
            return []
        case .preparing, .countIn, .playing, .paused:
            endRun()
            barOffset = 0
            elapsedBefore = 0
            notice = nil
            state = .idle
            return [.silence, .releaseAudio]
        }
    }

    /// Play/Pause key and pedal: Start, Pause or Resume depending on the state.
    @discardableResult
    public mutating func togglePlayPause(atFrame now: Int64) -> [TransportEffect] {
        state.isRunning ? pause(atFrame: now) : start()
    }

    // MARK: System events

    /// Pause and keep the place; never resumes on its own (Apple HIG › Playing audio).
    /// While paused or idle nothing changes.
    @discardableResult
    public mutating func interrupted(by cause: TransportInterruption, atFrame now: Int64) -> [TransportEffect] {
        let message: TransportNotice = switch cause {
        case .audioTakenOver: .audioTakenOver
        case .outputChanged: .outputChanged
        case .background: .stoppedInBackground
        }
        switch state {
        case .countIn, .playing:
            let effects = pause(atFrame: now)
            notice = message
            return effects
        case let .preparing(resuming):
            state = resuming ? .paused : .idle
            notice = message
            return resuming ? [] : [.releaseAudio]
        case .idle, .paused, .interrupted:
            return []
        }
    }

    /// The render callback found clicks it could not play in time.
    /// In the background that already broke your time, so pause; on screen keep going.
    @discardableResult
    public mutating func skippedClicks(_ count: Int, inBackground: Bool, atFrame now: Int64) -> [TransportEffect] {
        guard count > 0, state.isRunning else { return [] }
        if inBackground {
            let effects = pause(atFrame: now)
            notice = .fellBehindInBackground(skipped: count)
            return effects
        }
        if notice?.isBlocking != true { notice = .timingHiccup(skipped: count) }
        return []
    }

    /// The audio engine died and could not be restarted. Needs a deliberate Start.
    @discardableResult
    public mutating func audioStopped() -> [TransportEffect] {
        guard state.isActive else { return [] }
        endRun()
        barOffset = 0
        elapsedBefore = 0
        notice = .audioStopped
        state = .interrupted
        return [.silence, .releaseAudio]
    }

    /// Close the message bar. After a system stop this also returns to Ready.
    public mutating func dismissNotice() {
        notice = nil
        if state == .interrupted { state = .idle }
    }

    // MARK: Setup changes

    /// New tempo. While running it is queued and lands per `tempoChangesLandOn`;
    /// several changes before it lands combine (the latest wins).
    public mutating func setTempo(_ tempo: Tempo) {
        setup.tempo = tempo
        if state.isRunning { pending = PendingChange(tempo: tempo, pattern: pending?.pattern) }
    }

    /// Nudge by `delta` BPM (−5/−1/+1/+5, pedals, arrow keys), clamped to 20–300.
    public mutating func nudgeTempo(by delta: Int) {
        let range = Tempo.supportedRange
        let bpm = min(range.upperBound, max(range.lowerBound, setup.tempo.bpm + Rational(delta)))
        guard bpm != setup.tempo.bpm, let tempo = try? Tempo(bpm: bpm, beatUnit: setup.tempo.beatUnit) else { return }
        setTempo(tempo)
    }

    /// New meter, subdivision, accents or swing. While running: accent-only changes
    /// land on the next click; a new grid waits for the bar line (UX J4).
    public mutating func setPattern(_ pattern: ClickPattern) {
        setup.pattern = pattern
        if state.isRunning { pending = PendingChange(tempo: setup.tempo, pattern: pattern) }
    }

    public mutating func setCountIn(_ mode: CountInMode, bars: Int? = nil) {
        setup.countInMode = mode
        if let bars { setup.countInBars = min(2, max(1, bars)) }
    }

    /// Gap click on/off. Takes effect for clicks not yet scheduled.
    public mutating func setGaps(_ gaps: GapPattern) {
        setup.gaps = gaps
        if let plan, let changed = try? plan.withGaps(gaps) { self.plan = changed }
    }

    public mutating func setTempoChangesLandOn(_ boundary: ChangeBoundary) {
        setup.tempoChangesLandOn = boundary
    }

    // MARK: Clock

    /// Clicks from `scheduledThrough` up to `horizon` (exclusive). Call from the
    /// scheduler with `horizon = now + lookahead`; consecutive calls never repeat
    /// or skip a click. Pending changes are placed first.
    public mutating func schedule(through horizon: Int64) -> ClickBatch? {
        guard state.isRunning, let plan else { return nil }
        placePending()
        let range = scheduledThrough..<max(scheduledThrough, horizon)
        let clicks = (self.plan ?? plan).events(in: range)
        scheduledThrough = range.upperBound
        return ClickBatch(generation: generation, frames: range, clicks: clicks)
    }

    /// Where the music is at `now` (the frame being heard), or nil when nothing plays.
    /// Also moves count-in → playing and retires changes that have landed.
    @discardableResult
    public mutating func playhead(atFrame now: Int64) -> Playhead? {
        guard state.isRunning, let plan, now >= plan.startFrame else { return nil }
        let next = plan.firstBar(startingAtOrAfter: now + 1) ?? (lastPlanBar ?? -countInBars) + 1
        let bar = next - 1
        lastPlanBar = bar
        if state == .countIn, bar >= 0 { state = .playing }
        if let change = queued, now >= change.frame {
            landed = change
            queued = nil
        }
        if let change = landed, bar > change.position.bar { landed = nil }
        let isCountIn = bar < 0
        return Playhead(
            bar: isCountIn ? bar + countInBars + 1 : barOffset + bar + 1,
            isCountIn: isCountIn,
            planBar: bar,
            elapsedFrames: elapsedBefore + musicFrames(until: now)
        )
    }

    // MARK: Pedals

    /// Transport actions from a pedal. Returns nil for actions the app handles
    /// itself (songs, charts, gap click, tap tempo).
    @discardableResult
    public mutating func perform(_ action: MIDIAction, atFrame now: Int64) -> [TransportEffect]? {
        switch action {
        case .playPause: return togglePlayPause(atFrame: now)
        case .stop: return stop()
        case .tempoUp: nudgeTempo(by: 1); return []
        case .tempoDown: nudgeTempo(by: -1); return []
        case .toggleCountIn:
            setCountIn(setup.countInMode == .off ? .everyStart : .off)
            return []
        case .panicRestart:
            // Silence everything and start clean from bar 1.
            let stopped = stop()
            return stopped.filter { $0 != .releaseAudio } + start()
        case .nextSong, .previousSong, .tapTempo, .toggleGapClick, .nextChartPage, .previousChartPage:
            return nil
        }
    }

    // MARK: Private

    private mutating func endRun() {
        plan = nil
        generation += 1
        pending = nil
        queued = nil
        landed = nil
        lastPlanBar = nil
        countInBars = 0
    }

    /// Music time in this run (count-in excluded).
    private func musicFrames(until now: Int64) -> Int64 {
        guard let plan, let musicStart = plan.startFrame(ofBar: 0) else { return 0 }
        return max(0, now - musicStart)
    }

    /// Put the pending change on the timeline at the first allowed point not yet scheduled.
    private mutating func placePending() {
        guard let change = pending, let plan else { return }
        let transform: (inout PlaybackSegment) -> Void = { segment in
            if let tempo = change.tempo { segment.tempo = tempo }
            if let pattern = change.pattern, segment.role == .music { segment.pattern = pattern }
        }
        // Accent-only changes keep the bar's grid and land on the next click;
        // a new meter or subdivision has to wait for the bar line.
        let order: [ChangeBoundary] = change.pattern == nil ? [setup.tempoChangesLandOn] : [.step, .bar]
        for boundary in order {
            guard let position = plan.firstBoundary(atOrAfter: scheduledThrough, unit: boundary),
                  let changed = try? plan.changing(at: position, transform),
                  let frame = changed.startFrame(of: position) else { continue }
            self.plan = changed
            queued = QueuedChange(position: position, frame: frame, tempo: change.tempo, pattern: change.pattern, boundary: boundary)
            pending = nil
            return
        }
    }
}

/// Tap tempo (UX J3): two taps set a tempo, averaging up to the last four gaps;
/// a pause of more than 2 seconds starts over. Taps make no sound.
public struct TapTempo: Sendable, Hashable {
    public enum Result: Sendable, Hashable {
        /// First tap: show "Tap again".
        case tapAgain
        case tempo(Tempo)
    }

    public static let resetAfterSeconds = 2.0
    private var taps: [Double] = []

    public init() {}

    /// `time` in seconds on any steady clock. Tempo rounds to a whole BPM, clamped to 20–300.
    public mutating func tap(at time: Double, beatUnit: NoteValue = .quarter) -> Result {
        if let last = taps.last, time - last > TapTempo.resetAfterSeconds || time <= last { taps.removeAll() }
        taps.append(time)
        if taps.count > 5 { taps.removeFirst() }
        guard taps.count >= 2, let first = taps.first, let last = taps.last else { return .tapAgain }
        let gap = (last - first) / Double(taps.count - 1)
        let bpm = min(300, max(20, (60 / gap).rounded()))
        guard let tempo = try? Tempo(bpm: bpm, beatUnit: beatUnit) else { return .tapAgain }
        return .tempo(tempo)
    }
}
