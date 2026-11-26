/* POCKET web test — Quick Click + diagnostics.
 * Audio clock: Web Audio. A worker timer wakes the scheduler every 25 ms; the
 * scheduler asks the immutable PlaybackPlan for events in a 150 ms lookahead
 * window and schedules preloaded buffers at exact AudioContext times.
 * UI timers never decide when a click sounds. */
(function () {
  "use strict";
  const T = window.PocketTiming;
  const L = T.LEVEL;

  const LOOKAHEAD = 0.15;   // seconds scheduled ahead (plan §06: start at 100–200 ms)
  const TICK_MS = 25;
  const START_DELAY = 0.12; // first click this long after Start
  const MIN_LEAD = 0.003;   // never schedule closer than this to "now"
  const IS_PWA = window.POCKET_PWA === true;

  /** Which browser and engine this is. Every browser on iPad (Chrome included) runs WebKit. */
  function detectBrowser() {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const device = ios ? (/iPhone|iPod/.test(ua) ? "iPhone" : "iPad") : /Android/.test(ua) ? "Android" : "computer";
    let name;
    if (ios) name = /CriOS/.test(ua) ? "Chrome" : /FxiOS/.test(ua) ? "Firefox" : /EdgiOS/.test(ua) ? "Edge" : "Safari";
    else name = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Unknown browser";
    const engine = ios || name === "Safari" ? "WebKit" : name === "Firefox" ? "Gecko" : "Blink";
    return { name, device, ios, engine, label: `${name} on ${device === "computer" ? "a computer" : device} (${engine})` };
  }
  const BROWSER = detectBrowser();
  function installSteps() {
    if (BROWSER.ios && BROWSER.name === "Chrome") return "In Chrome, tap the Share icon in the address bar → Add to Home Screen";
    if (BROWSER.ios && BROWSER.name === "Safari") return "In Safari, tap Share → Add to Home Screen";
    if (BROWSER.ios) return "Use the browser's Share menu → Add to Home Screen";
    if (BROWSER.device === "Android") return `In ${BROWSER.name}, tap the ⋮ menu → Add to Home screen`;
    if (BROWSER.name === "Chrome" || BROWSER.name === "Edge") return `In ${BROWSER.name}, use the install icon in the address bar (or menu → Install POCKET)`;
    return "Install it from the browser menu if offered";
  }

  const METERS = [
    { id: "4/4", num: 4, den: 4 },
    { id: "3/4", num: 3, den: 4 },
    { id: "2/4", num: 2, den: 4 },
    { id: "5/4", num: 5, den: 4 },
    { id: "6/8", num: 6, den: 8 },
    { id: "7/8a", num: 7, den: 8, grouping: [2, 2, 3], label: "7/8", note: "2+2+3" },
    { id: "7/8b", num: 7, den: 8, grouping: [3, 2, 2], label: "7/8", note: "3+2+2" },
    { id: "9/8", num: 9, den: 8 },
    { id: "12/8", num: 12, den: 8 },
  ];
  const SUBDIVISIONS = [1, 2, 3, 4, 5, 6, 7];
  const COUNT_IN_MODES = [{ id: "every", label: "Every start" }, { id: "first", label: "First start only" }, { id: "off", label: "Off" }];
  const COUNT_IN_BARS = [1, 2];
  const CONCEPTS = [
    { id: "a", label: "A · Studio", name: "Studio instrument" },
    { id: "b", label: "B · Workshop", name: "Analog workshop" },
    { id: "c", label: "C · Stage", name: "Minimal stage" },
    { id: "d", label: "D · Console", name: "Hardware console (owner reference)" },
  ];
  const TEMPO_CHANGE = [{ id: "beat", label: "Next beat" }, { id: "bar", label: "Next bar" }];
  const SOUNDS = [{ id: "wood", label: "Wood" }, { id: "beep", label: "Beep" }];
  const CYCLE = [L.downbeat, L.group, L.normal, L.muted];

  const CHECKS = [
    {
      id: "steady", title: "1 · Steady for 30 minutes",
      text: "Wired headphones, your practice tempo, screen on. Let it run 30 minutes. It passes if it sounds steady and Missed clicks stays at 0. To compare browsers, run the checks in each one (Safari, Chrome) and copy a report from each.",
      rows: [{ id: "steady", label: "30-minute run", options: ["Not tried", "Steady, 0 missed", "Heard a glitch", "Missed clicks"] }],
    },
    {
      id: "interrupt", title: "2 · Interruptions",
      text: "While it plays, try each one. Record what happened. The rule from the plan: it should never resume on its own.",
      rows: [
        { id: "lock", label: "Screen dims or locks (set Keep screen awake to Off first)" },
        { id: "notify", label: "A notification, timer or alarm" },
        { id: "unplug", label: "Unplug, then plug in the headphones" },
        { id: "switch", label: "Switch to another app, then come back" },
        { id: "call", label: "A call or FaceTime (optional)" },
      ].map((r) => ({ ...r, options: ["Not tried", "Kept playing", "Stopped with a message", "Stopped silently", "Something else (see notes)"] })),
    },
    {
      id: "silent", title: "3 · Silent mode",
      text: "Turn on silent mode (Control Center, or the switch on older iPads) and press Start. Then start music in another app and come back to POCKET.",
      rows: [
        { id: "silentPlays", label: "Silent mode on: the click still plays", options: ["Not tried", "Plays", "Silent", "Plays only after a second Start"] },
        { id: "silentMusic", label: "Music from another app while POCKET plays", options: ["Not tried", "Both play", "Music stopped", "POCKET went silent"] },
      ],
    },
    {
      id: "concepts", title: "4 · Design concepts",
      text: "Switch between A, B and C at the top. Use each for a real practice stretch, in daylight and at night, at your stand. Note which you'd keep.",
      rows: CONCEPTS.map((c) => ({ id: `concept-${c.id}`, label: `${c.label} (${c.name})`, options: ["Not tried", "Favourite", "Usable", "Not for me"] })),
    },
    {
      id: "offline", title: "5 · Offline from the Home Screen",
      text: `Needs the hosted home-screen version, not this preview. ${installSteps()}. Open it once, turn on Airplane Mode, close it fully, reopen and press Start.`,
      rows: [{ id: "offline", label: "Opens and plays offline", options: ["Not tried", "Works offline", "Doesn't load", "Loads but no sound"] }],
    },
  ];

  // ---------- persistence (per-device conveniences only) ----------
  const STORE_KEY = "pocket-webtest-v1";
  function loadStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; } }
  function saveStore() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        bpm: settings.bpm, meterId: settings.meterId, accents: settings.accents, subdivision: settings.subdivision,
        countInMode: settings.countInMode, countInBars: settings.countInBars, tempoChange: settings.tempoChange, sound: settings.sound, volume: settings.volume,
        awake: settings.awake, routeStop: settings.routeStop, playOnSilent: settings.playOnSilent, concept: settings.concept, answers, notes: $("notes").value,
      }));
    } catch { /* storage unavailable: fine */ }
  }
  const stored = loadStore();

  const settings = {
    bpm: clampBpm(stored.bpm ?? 120),
    meterId: METERS.some((m) => m.id === stored.meterId) ? stored.meterId : "4/4",
    accents: Array.isArray(stored.accents) ? stored.accents : null,
    subdivision: SUBDIVISIONS.includes(stored.subdivision) ? stored.subdivision : 1,
    // Count-in: when it plays (every start incl. resume / first start after opening / off) and how long.
    countInMode: COUNT_IN_MODES.some((m) => m.id === stored.countInMode) ? stored.countInMode : stored.countIn === 0 ? "off" : "every",
    countInBars: COUNT_IN_BARS.includes(stored.countInBars) ? stored.countInBars : COUNT_IN_BARS.includes(stored.countIn) ? stored.countIn : 1,
    // Where a tempo change lands while playing (Docs/UX.md O-1): next beat by default.
    tempoChange: TEMPO_CHANGE.some((t) => t.id === stored.tempoChange) ? stored.tempoChange : "beat",
    sound: SOUNDS.some((s) => s.id === stored.sound) ? stored.sound : "wood",
    volume: Number.isFinite(stored.volume) ? stored.volume : 60,
    awake: ["off", "playing", "always"].includes(stored.awake) ? stored.awake : stored.wake === false ? "off" : "always",
    routeStop: stored.routeStop ?? true,
    // Play even when the iPad is on silent (owner requirement). On by default.
    playOnSilent: stored.playOnSilent ?? true,
    // Visual concept being compared (plan §04): a Studio, b Workshop, c Stage.
    concept: CONCEPTS.some((c) => c.id === stored.concept) ? stored.concept : "a",
  };
  const answers = stored.answers || {};

  // ---------- engine state ----------
  const eng = {
    status: "idle",          // idle | countIn | playing | paused | interrupted
    ctx: null, master: null, buffers: null,
    plan: null, scheduledUntil: 0, sources: new Set(), visual: [],
    pending: null, queued: null, nowNote: null,
    hasStarted: false, barOffset: 0, elapsedBefore: 0,
    soundingPattern: null, catchingUp: false,
    worker: null, fallbackTimer: null, lastTick: 0,
    wakeLock: null, runStartPerf: 0, hiddenAt: null, missedAtHide: 0,
    clockRef: null, currentUnit: -1, currentRole: null, currentBar: null, countInBars: 0,
  };
  const stats = freshStats();
  function freshStats() {
    return {
      scheduled: 0, missed: 0, missEvents: 0, worstGapVisible: 0, worstGapHidden: 0,
      minHeadroom: Infinity, driftPpm: null, runSeconds: 0, starts: 0, interruptions: 0,
    };
  }

  const $ = (id) => document.getElementById(id);

  // ---------- model helpers ----------
  function clampBpm(v) { return Math.min(T.TEMPO_MAX, Math.max(T.TEMPO_MIN, Math.round(v * 100) / 100)); }
  function meterDef() { return METERS.find((m) => m.id === settings.meterId); }
  function currentMeter() { const d = meterDef(); return T.makeMeter(d.num, d.den, d.grouping); }
  function currentAccents(meter) {
    return settings.accents && settings.accents.length === meter.num ? settings.accents : T.defaultAccents(meter);
  }
  function currentPattern() {
    const meter = currentMeter();
    return T.makePattern({ meter, subdivision: settings.subdivision, accents: currentAccents(meter) });
  }
  function currentTempo() { return T.makeTempo(settings.bpm, currentMeter().defaultBeatUnit); }
  function glyphFor(beatUnit) {
    if (Math.abs(beatUnit - 3 / 8) < 1e-9) return "♩.";
    if (Math.abs(beatUnit - 1 / 8) < 1e-9) return "♪";
    return "♩";
  }
  const fmtBpm = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v * 10 - Math.round(v * 10)) < 1e-9 ? 1 : 2));

  // ---------- logging ----------
  const logEntries = [];
  function log(message, kind = "") {
    const t = performance.now() / 1000;
    const stamp = new Date();
    logEntries.push({ t, at: stamp.toISOString(), message, kind, status: eng.status });
    if (logEntries.length > 500) logEntries.shift();
    const li = document.createElement("li");
    const time = document.createElement("time");
    time.textContent = stamp.toTimeString().slice(0, 8);
    const span = document.createElement("span");
    span.textContent = message;
    if (kind) span.className = kind;
    li.append(time, span);
    const strip = document.getElementById("status-last");
    if (strip) strip.textContent = message;
    const list = $("log");
    list.prepend(li);
    while (list.children.length > 200) list.lastChild.remove();
  }

  let hiccupCount = 0;
  let hiccupTimer = null;
  /** Non-blocking notice; counts add up while it's showing, then it fades after 5 s. */
  function showHiccup(n) {
    hiccupCount += n;
    const el = $("hiccup");
    el.textContent = `Timing hiccup: ${hiccupCount} click${hiccupCount === 1 ? " was" : "s were"} skipped. Close other apps if it happens again.`;
    el.hidden = false;
    el.classList.remove("fading");
    clearTimeout(hiccupTimer);
    hiccupTimer = setTimeout(() => {
      el.classList.add("fading");
      hiccupTimer = setTimeout(() => { el.hidden = true; el.classList.remove("fading"); hiccupCount = 0; }, 400);
    }, 5000);
  }

  function showBanner(text) { $("banner-text").textContent = text; $("banner").hidden = false; }
  function hideBanner() { $("banner").hidden = true; }

  // ---------- sound ----------
  function buildBuffers(ctx) {
    const sr = ctx.sampleRate;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    function synth({ freqs, decay, noise = 0, amp, dur = 0.08 }) {
      const n = Math.floor(sr * dur);
      const buf = ctx.createBuffer(1, n, sr);
      const d = buf.getChannelData(0);
      const fadeStart = n - Math.floor(sr * 0.003);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        let v = 0;
        for (const f of freqs) v += Math.sin(2 * Math.PI * f * t);
        v /= freqs.length;
        if (noise) v += noise * rnd() * Math.exp(-t / 0.0015);
        let env = Math.exp(-t / decay) * Math.min(1, t / 0.0004);
        if (i > fadeStart) env *= (n - i) / (n - fadeStart);
        d[i] = amp * v * env;
      }
      return buf;
    }
    return {
      wood: {
        [L.downbeat]: synth({ freqs: [1760, 2640], decay: 0.014, noise: 0.45, amp: 0.85 }),
        [L.group]: synth({ freqs: [1480, 2220], decay: 0.013, noise: 0.4, amp: 0.7 }),
        [L.normal]: synth({ freqs: [1200, 1800], decay: 0.012, noise: 0.35, amp: 0.55 }),
        [L.sub]: synth({ freqs: [980], decay: 0.01, noise: 0.25, amp: 0.3 }),
        countIn: synth({ freqs: [620, 930], decay: 0.035, noise: 0.2, amp: 0.65, dur: 0.12 }),
      },
      beep: {
        [L.downbeat]: synth({ freqs: [1760], decay: 0.03, amp: 0.75 }),
        [L.group]: synth({ freqs: [1320], decay: 0.028, amp: 0.65 }),
        [L.normal]: synth({ freqs: [880], decay: 0.025, amp: 0.55 }),
        [L.sub]: synth({ freqs: [660], decay: 0.02, amp: 0.28 }),
        countIn: synth({ freqs: [440], decay: 0.05, amp: 0.65, dur: 0.12 }),
      },
    };
  }

  function ensureAudio() {
    if (eng.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("this browser has no Web Audio");
    eng.ctx = new Ctx({ latencyHint: "interactive" });
    eng.master = eng.ctx.createGain();
    eng.master.gain.value = volumeGain(settings.volume);
    eng.master.connect(eng.ctx.destination);
    eng.buffers = buildBuffers(eng.ctx);
    eng.ctx.addEventListener("statechange", onAudioState);
    log(`Audio ready: ${eng.ctx.sampleRate} Hz, base latency ${ms(eng.ctx.baseLatency)}, output latency ${ms(eng.ctx.outputLatency)}`, "info");
  }
  const volumeGain = (pct) => Math.pow(pct / 100, 2);
  const ms = (s) => (typeof s === "number" && Number.isFinite(s) ? `${(s * 1000).toFixed(1)} ms` : "n/a");

  // ---------- playing through silent mode ----------
  // iPadOS treats web audio as "ambient" by default, so silent mode mutes it.
  // Two ways to switch the page to "playback", used together:
  //  1. navigator.audioSession.type = "playback" (Safari 16.4+; may be missing in
  //     Chrome and other iPad browsers).
  //  2. A looping, inaudible <audio> track started from the Start tap. Playing a
  //     media element moves the page into playback, which Web Audio follows.
  // Playback audio can pause music playing in other apps; the test checks that.
  const silentState = { track: null, status: "off" };

  function silentTrackUrl() {
    // 1 s of 16-bit mono silence at 8 kHz as a WAV data URI.
    const rate = 8000, samples = rate, dataBytes = samples * 2;
    const buf = new ArrayBuffer(44 + dataBytes);
    const v = new DataView(buf);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, dataBytes, true);
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return "data:audio/wav;base64," + btoa(bin);
  }

  function setAudioSession() {
    const wanted = settings.playOnSilent ? "playback" : "auto";
    try {
      if (navigator.audioSession && navigator.audioSession.type !== wanted) {
        navigator.audioSession.type = wanted;
        log(`Audio session set to ${wanted}${wanted === "playback" ? " (plays in silent mode)" : ""}`, "info");
      }
    } catch (e) { log(`Could not set audio session: ${e.message}`, "warn"); }
  }

  /** Call from the Start/Resume tap so the browser allows playback. */
  async function startSilentTrack() {
    if (!settings.playOnSilent) { stopSilentTrack(); return; }
    if (!silentState.track) {
      const a = document.createElement("audio");
      a.src = silentTrackUrl();
      a.loop = true;
      a.preload = "auto";
      a.setAttribute("playsinline", "");
      a.setAttribute("aria-hidden", "true");
      a.addEventListener("pause", () => {
        if (silentState.status === "on" && isRunning()) log("Silent-mode track was paused by the system; silent mode may mute the click", "warn");
      });
      silentState.track = a;
      if ("mediaSession" in navigator && window.MediaMetadata) {
        try { navigator.mediaSession.metadata = new MediaMetadata({ title: "POCKET click", artist: "POCKET" }); } catch { /* optional */ }
      }
    }
    if (!silentState.track.paused) return;
    try {
      await silentState.track.play();
      silentState.status = "on";
      log("Silent-mode track playing (click plays in silent mode)", "info");
    } catch (e) {
      silentState.status = "blocked";
      log(`Silent-mode track blocked (${e.message}); relying on the audio session setting`, "warn");
    }
  }
  function stopSilentTrack() {
    if (silentState.track && !silentState.track.paused) silentState.track.pause();
    if (silentState.status === "on") silentState.status = "off";
  }
  function silentModeStatus() {
    if (!settings.playOnSilent) return "off (silent mode mutes the click)";
    const parts = [];
    if (navigator.audioSession && navigator.audioSession.type === "playback") parts.push("audio session");
    if (silentState.status === "on") parts.push("silent track");
    if (parts.length) return `on (${parts.join(" + ")})`;
    return silentState.status === "blocked" ? "track blocked; may be muted" : "on from next Start";
  }


  // ---------- transport ----------
  const isRunning = () => eng.status === "playing" || eng.status === "countIn";

  /** Count-in bars for this start, per the count-in setting (Docs/UX.md J6). */
  function countInFor(isResume) {
    if (settings.countInMode === "off") return 0;
    if (settings.countInMode === "first" && (isResume || eng.hasStarted)) return 0;
    return settings.countInBars;
  }

  async function start(isResume = false) {
    if (isRunning()) return;
    hideBanner();
    try {
      setAudioSession();
      const track = startSilentTrack(); // same tap as Start, so the browser allows it
      ensureAudio();
      if (eng.ctx.state !== "running") await eng.ctx.resume();
      await track;
      if (eng.ctx.state !== "running") throw new Error(`audio is ${eng.ctx.state}`);
      const pattern = currentPattern();
      const tempo = currentTempo();
      const countIn = countInFor(isResume);
      eng.plan = T.PlaybackPlan.click({ pattern, tempo, countInBars: countIn, startTime: eng.ctx.currentTime + START_DELAY });
      eng.scheduledUntil = eng.plan.startTime;
      eng.visual = [];
      eng.pending = null;
      eng.queued = null;
      eng.nowNote = null;
      if (!isResume) { eng.barOffset = 0; eng.elapsedBefore = 0; }
      eng.runStartPerf = performance.now();
      eng.lastTick = performance.now();
      eng.clockRef = null;
      eng.countInBars = countIn;
      eng.currentBar = null;
      eng.soundingPattern = pattern;
      eng.hasStarted = true;
      stats.starts++;
      setStatus(countIn > 0 ? "countIn" : "playing");
      log(`${isResume ? "Resume" : "Start"}: ${fmtBpm(tempo.bpm)} BPM, ${pattern.meter.label}, subdivision ${pattern.subdivision}, count-in ${countIn}`);
      startTimer();
      schedule();
    } catch (err) {
      setStatus(isResume ? "paused" : "idle");
      log(`Start failed: ${err.message}`, "warn");
      showBanner("No sound yet. Check the volume and that the iPad isn't muted, then press Start.");
    }
  }

  /** Silence now and forget scheduled clicks; shared by stop and pause. */
  function silence() {
    stopTimer();
    for (const src of eng.sources) { try { src.stop(); } catch { /* already stopped */ } }
    eng.sources.clear();
    eng.visual = [];
    eng.pending = null;
    eng.queued = null;
    eng.nowNote = null;
    if (eng.runStartPerf) {
      const ran = (performance.now() - eng.runStartPerf) / 1000;
      stats.runSeconds += ran;
      eng.elapsedBefore += ran;
    }
    eng.runStartPerf = 0;
    eng.soundingPattern = null;
    renderBeats();
  }

  function pause() {
    if (!isRunning()) return;
    // Resume continues from the next bar number.
    if (eng.currentBar !== null && eng.currentBar >= 0) eng.barOffset += eng.currentBar + 1;
    silence();
    setStatus("paused");
    log(`Pause at bar ${eng.barOffset}`);
    renderTempoNote();
  }

  function stop(reason, cause = "") {
    if ((eng.status === "idle" || eng.status === "interrupted") && !reason) return;
    silence();
    stopSilentTrack();
    if (reason) {
      stats.interruptions++;
      setStatus("interrupted");
      showBanner(reason);
      log(`Stopped by the system${cause ? ` (${cause})` : ""}: ${reason}`, "warn");
    } else {
      setStatus("idle");
      log("Stop");
    }
    renderTempoNote();
  }

  function setStatus(s) {
    eng.status = s;
    const pill = $("status-pill");
    pill.dataset.state = s;
    pill.textContent = { idle: "Ready", countIn: "Count-in", playing: "Running", paused: "Paused", interrupted: "Stopped" }[s];
    const running = s === "playing" || s === "countIn";
    // Primary: Start / Stop / Resume. Secondary: Pause while running, Stop while paused.
    const primary = $("start");
    primary.dataset.running = String(running);
    primary.textContent = running ? "Stop" : s === "paused" ? "Resume" : "Start";
    const secondary = $("pause");
    secondary.hidden = !(running || s === "paused");
    secondary.textContent = s === "paused" ? "Stop" : "Pause";
    if (!running) { eng.currentUnit = -1; renderActiveBeat(); }
    if (s === "idle" || s === "interrupted") { $("pos-bar").textContent = "Bar –"; }
    renderLcd();
    updateAwake();
  }

  function startTimer() {
    stopTimer();
    try {
      if (!eng.worker) {
        const src = `let id=null;onmessage=(e)=>{clearInterval(id);id=null;if(e.data==="start"){id=setInterval(()=>postMessage(0),${TICK_MS});}};`;
        eng.worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
        eng.worker.onmessage = schedule;
      }
      eng.worker.postMessage("start");
    } catch (e) {
      log(`Worker timer unavailable (${e.message}); using page timer`, "warn");
      eng.fallbackTimer = setInterval(schedule, TICK_MS);
    }
  }
  function stopTimer() {
    if (eng.worker) eng.worker.postMessage("stop");
    if (eng.fallbackTimer) { clearInterval(eng.fallbackTimer); eng.fallbackTimer = null; }
  }

  function schedule() {
    if (!(eng.status === "playing" || eng.status === "countIn")) return;
    const ctx = eng.ctx;
    if (ctx.state !== "running") return; // statechange handler deals with it
    const perfNow = performance.now();
    const gap = perfNow - eng.lastTick;
    eng.lastTick = perfNow;
    if (document.hidden) stats.worstGapHidden = Math.max(stats.worstGapHidden, gap);
    else stats.worstGapVisible = Math.max(stats.worstGapVisible, gap);

    const now = ctx.currentTime;
    applyPending();

    let from = eng.scheduledUntil;
    if (from < now + MIN_LEAD) {
      const missed = eng.plan.eventsIn(from, now + MIN_LEAD);
      if (missed.length) {
        stats.missed += missed.length;
        stats.missEvents++;
        log(`Missed ${missed.length} click${missed.length > 1 ? "s" : ""}: scheduler woke ${((now - from) * 1000).toFixed(0)} ms late${document.hidden ? " (page hidden)" : ""}`, "warn");
        // On screen: tell the player without stopping (Docs/UX.md › Messages, "Timing hiccup").
        // In the background the return-to-page rule handles it instead.
        if (!document.hidden && !eng.catchingUp) showHiccup(missed.length);
      }
      from = now + MIN_LEAD;
    }
    const to = now + LOOKAHEAD;
    if (to <= from) return;
    const sounds = eng.buffers[settings.sound];
    for (const e of eng.plan.eventsIn(from, to)) {
      const src = ctx.createBufferSource();
      src.buffer = e.role === "countIn" ? sounds.countIn : sounds[e.level];
      src.connect(eng.master);
      src.start(e.time);
      eng.sources.add(src);
      src.onended = () => eng.sources.delete(src);
      e.pattern = eng.plan.segments[e.segment].pattern;
      eng.visual.push(e);
      stats.scheduled++;
      stats.minHeadroom = Math.min(stats.minHeadroom, e.time - now);
    }
    eng.scheduledUntil = to;
  }

  /**
   * Apply queued changes to the part of the plan not yet scheduled.
   * Pattern changes (meter, subdivision, accents) land on the next bar line.
   * Tempo changes land on the next beat or bar, per settings.tempoChange.
   */
  function applyPending() {
    if (!eng.pending) return;
    const { tempo, pattern } = eng.pending;
    let pos;
    if (pattern) {
      pos = eng.plan.firstBoundaryAtOrAfter(eng.scheduledUntil, "bar");
      if (!pos) return;
      eng.plan = eng.plan.changingAt(pos, (s) => ({ ...s, tempo: tempo || s.tempo, pattern: s.role === "music" ? pattern : s.pattern }));
    } else {
      pos = eng.plan.firstBoundaryAtOrAfter(eng.scheduledUntil, settings.tempoChange);
      if (!pos) return;
      eng.plan = eng.plan.changingTempoAt(tempo, pos);
    }
    eng.queued = { ...pos, label: eng.pending.label, unit: pattern ? "bar" : settings.tempoChange };
    eng.pending = null;
    log(`Change queued for bar ${pos.bar + 1}${pos.grid ? `, step ${pos.grid + 1}` : ""}: ${eng.queued.label}`);
    renderTempoNote();
  }

  /** kind: "tempo" or "pattern". A pattern change carries the tempo too (meter can change the beat unit). */
  function queueChange(kind) {
    if (!isRunning()) return;
    const prev = eng.pending || {};
    const pattern = kind === "pattern" ? currentPattern() : prev.pattern;
    const tempo = currentTempo();
    const parts = [`${fmtBpm(tempo.bpm)} BPM`];
    if (pattern) parts.push(pattern.meter.label + (pattern.subdivision > 1 ? ` ÷${pattern.subdivision}` : ""));
    eng.pending = { tempo, pattern, label: parts.join(", ") };
    renderTempoNote();
  }

  // ---------- system events ----------
  function onAudioState() {
    const st = eng.ctx.state;
    log(`Audio state: ${st}`, st === "running" ? "info" : "warn");
    if ((eng.status === "playing" || eng.status === "countIn") && st !== "running") {
      // Copy from Docs/UX.md › Messages.
      stop(document.hidden
        ? "Click stopped while POCKET was in the background. Press Start to play again."
        : "Click stopped. A call or another app took over the sound. Press Start when you're ready.", `audio ${st}`);
    }
  }

  document.addEventListener("visibilitychange", () => {
    const playing = eng.status === "playing" || eng.status === "countIn";
    if (document.hidden) {
      eng.hiddenAt = performance.now();
      eng.missedAtHide = stats.missed;
      log(`Page hidden${playing ? " while playing" : ""}`);
    } else {
      const away = eng.hiddenAt ? ((performance.now() - eng.hiddenAt) / 1000).toFixed(1) : "?";
      eng.hiddenAt = null;
      // Catch up first so clicks skipped while away are counted, then apply the
      // UX rule: if time was broken while away, stop and say so (Docs/UX.md).
      if (playing && eng.ctx && eng.ctx.state === "running") {
        eng.catchingUp = true;
        try { schedule(); } finally { eng.catchingUp = false; }
      }
      const missed = stats.missed - eng.missedAtHide;
      log(`Page visible after ${away} s; ${missed} clicks missed while away; audio ${eng.ctx ? eng.ctx.state : "not started"}`, missed ? "warn" : "info");
      if (playing && eng.ctx && eng.ctx.state !== "running") {
        stop("Click stopped while POCKET was in the background. Press Start to play again.", "audio stopped in background");
      } else if (playing && missed > 0) {
        stop(`Click stopped: POCKET skipped ${missed} click${missed === 1 ? "" : "s"} while in the background. Press Start to play again.`, "clicks skipped in background");
      }
    }
    updateAwake();
  });
  window.addEventListener("pagehide", (e) => log(`Page hide${e.persisted ? " (kept in memory)" : ""}`));
  window.addEventListener("pageshow", (e) => { if (e.persisted) log("Page restored from memory"); });
  document.addEventListener("freeze", () => log("Page frozen by the browser", "warn"));
  document.addEventListener("resume", () => log("Page resumed after freeze", "warn"));
  window.addEventListener("online", () => log("Network: online"));
  window.addEventListener("offline", () => log("Network: offline"));
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener("devicechange", () => {
      const playing = eng.status === "playing" || eng.status === "countIn";
      log(`Audio devices changed${playing ? " while playing" : ""}; output latency now ${ms(eng.ctx && eng.ctx.outputLatency)}`, "warn");
      if (playing && settings.routeStop) {
        stop("Click stopped because the sound output changed. Check where it will play, then press Start.", "output changed");
      }
    });
  }

  // ---------- keep the screen awake ----------
  // Wake Lock API first; if it's missing or refused, a silent looping inline
  // video (the NoSleep technique) keeps iPadOS from dimming and auto-locking.
  // Either way it only works while this page is in front: a web page cannot
  // unlock the iPad or stop the side button from locking it.
  const awakeState = { method: "off", video: null, wantTap: false, busy: false, again: false };
  function wantAwake() {
    // Paused counts as playing: you're mid-practice.
    const running = isRunning() || eng.status === "paused";
    return !document.hidden && (settings.awake === "always" || (settings.awake === "playing" && running));
  }
  async function updateAwake() {
    if (awakeState.busy) { awakeState.again = true; return; }
    awakeState.busy = true;
    awakeState.again = false;
    try {
      if (!wantAwake()) { releaseAwake(); return; }
      if (eng.wakeLock || (awakeState.video && !awakeState.video.paused)) return;
      if ("wakeLock" in navigator) {
        try {
          const lock = await navigator.wakeLock.request("screen");
          eng.wakeLock = lock;
          lock.addEventListener("release", () => {
            if (eng.wakeLock === lock) eng.wakeLock = null;
            log("Screen wake lock released");
            setAwakeMethod("off");
            if (wantAwake()) setTimeout(updateAwake, 250);
          });
          setAwakeMethod("wakeLock");
          log("Screen will stay awake (Wake Lock)", "info");
          return;
        } catch (e) {
          log(`Wake Lock refused (${e.message}); trying the silent video`, "warn");
        }
      }
      await startAwakeVideo();
    } finally {
      awakeState.busy = false;
      renderAwake();
      if (awakeState.again) updateAwake();
    }
  }
  async function startAwakeVideo() {
    const media = window.POCKET_NOSLEEP_MEDIA;
    if (!media) { setAwakeMethod("unavailable"); return; }
    if (!awakeState.video) {
      const v = document.createElement("video");
      v.setAttribute("playsinline", "");
      v.setAttribute("muted", "");
      v.setAttribute("title", "Keeps the screen awake");
      v.setAttribute("aria-hidden", "true");
      v.muted = true;
      v.className = "awake-video";
      for (const [type, src] of [["webm", media.webm], ["mp4", media.mp4]]) {
        const source = document.createElement("source");
        source.src = src;
        source.type = `video/${type}`;
        v.append(source);
      }
      // Loop by seeking: a plain loop attribute is unreliable for this on iOS.
      v.addEventListener("timeupdate", () => { if (v.currentTime > 0.5) v.currentTime = Math.random() * 0.4; });
      document.body.append(v);
      awakeState.video = v;
    }
    try {
      await awakeState.video.play();
      awakeState.wantTap = false;
      setAwakeMethod("video");
      log("Screen will stay awake (silent video)", "info");
    } catch (e) {
      // Needs a tap first; the next tap anywhere retries.
      awakeState.wantTap = true;
      setAwakeMethod("needsTap");
    }
  }
  function releaseAwake() {
    if (eng.wakeLock) { const l = eng.wakeLock; eng.wakeLock = null; l.release().catch(() => {}); }
    if (awakeState.video && !awakeState.video.paused) awakeState.video.pause();
    awakeState.wantTap = false;
    setAwakeMethod("off");
  }
  function setAwakeMethod(m) { awakeState.method = m; renderAwake(); }
  function renderAwake() {
    const el = document.getElementById("awake-status");
    if (!el) return;
    const text = {
      wakeLock: "Screen is staying awake (Wake Lock).",
      video: "Screen is staying awake (silent video).",
      needsTap: "Tap anywhere to keep the screen awake.",
      unavailable: "This browser can't keep the screen awake.",
      off: settings.awake === "off" ? "Off: the iPad will dim and lock on its usual timer."
        : settings.awake === "playing" ? "Will keep the screen awake while the click is playing."
        : "Waiting to keep the screen awake.",
    }[awakeState.method];
    el.textContent = text;
    el.dataset.state = awakeState.method;
  }
  document.addEventListener("pointerdown", () => { if (awakeState.wantTap || (wantAwake() && awakeState.method !== "wakeLock" && awakeState.method !== "video")) updateAwake(); }, true);

  // ---------- visual loop ----------
  function frame() {
    const running = eng.status === "playing" || eng.status === "countIn";
    if (running && eng.ctx) {
      const t = eng.ctx.currentTime - (eng.ctx.outputLatency || 0);
      let latest = null;
      while (eng.visual.length && eng.visual[0].time <= t) latest = eng.visual.shift();
      if (latest && eng.queued && (latest.bar > eng.queued.bar || (latest.bar === eng.queued.bar && latest.grid >= eng.queued.grid))) {
        eng.nowNote = { text: `Now ${eng.queued.label}`, untilBar: latest.bar + 1 };
        eng.queued = null;
        renderTempoNote();
      }
      if (latest && latest.role === "music" && latest.pattern && patternKey(latest.pattern) !== patternKey(eng.soundingPattern)) {
        eng.soundingPattern = latest.pattern;
        renderBeats();
      }
      if (latest && latest.sub === 0) {
        eng.currentUnit = latest.unit;
        eng.currentRole = latest.role;
        eng.currentBar = latest.bar;
        if (latest.role === "music" && eng.status === "countIn") setStatus("playing");
        if (eng.nowNote && latest.bar >= eng.nowNote.untilBar) {
          eng.nowNote = null;
          renderTempoNote();
        }
        renderBeats();
        renderActiveBeat();
        renderLcd();
      }
      const elapsed = eng.elapsedBefore + (performance.now() - eng.runStartPerf) / 1000;
      $("pos-time").textContent = fmtClock(elapsed);
      $("pos-bar").textContent = eng.currentBar === null ? (eng.barOffset ? `Bar ${eng.barOffset + 1}` : "Bar –") : eng.currentBar < 0 ? `Count-in ${eng.currentBar + eng.countInBars + 1}` : `Bar ${eng.currentBar + eng.barOffset + 1}`;
    }
    requestAnimationFrame(frame);
  }
  const fmtClock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // Audio clock vs system clock, sampled every 2 s while running.
  setInterval(() => {
    const running = eng.status === "playing" || eng.status === "countIn";
    if (!running || !eng.ctx || !eng.ctx.getOutputTimestamp || document.hidden) return;
    const ts = eng.ctx.getOutputTimestamp();
    if (!ts || !(ts.contextTime > 0) || !(ts.performanceTime > 0)) return;
    if (!eng.clockRef) { eng.clockRef = ts; return; }
    const dPerf = (ts.performanceTime - eng.clockRef.performanceTime) / 1000;
    if (dPerf < 10) return;
    const dCtx = ts.contextTime - eng.clockRef.contextTime;
    stats.driftPpm = ((dCtx - dPerf) / dPerf) * 1e6;
  }, 2000);

  // ---------- rendering ----------
  function renderTempo() {
    const tempo = currentTempo();
    $("bpm-display").textContent = fmtBpm(tempo.bpm);
    $("bpm-display").setAttribute("aria-label", `Tempo ${fmtBpm(tempo.bpm)} BPM. Tap to type a tempo.`);
    $("beat-glyph").textContent = glyphFor(tempo.beatUnit);
    renderDial(tempo.bpm);
    renderLcd();
  }
  function renderTempoNote(error) {
    const note = $("tempo-note");
    note.classList.toggle("error", !!error);
    if (error) { note.textContent = error; return; }
    const when = (unit) => (unit === "bar" ? "Next bar" : "Next beat");
    if (eng.pending) note.textContent = `${when(eng.pending.pattern ? "bar" : settings.tempoChange)}: ${eng.pending.label}`;
    else if (eng.queued) note.textContent = `${when(eng.queued.unit)}: ${eng.queued.label}`;
    else if (eng.nowNote) note.textContent = eng.nowNote.text;
    else note.textContent = "";
  }

  const patternKey = (p) => (p ? `${p.meter.label}|${p.meter.grouping}|${p.accents}|${p.subdivision}` : "");
  const describePattern = (p) => p.meter.label + (p.subdivision > 1 ? ` ÷${p.subdivision}` : "");

  /**
   * The main row shows what you hear. While playing, a pattern change you've
   * made but that hasn't reached its bar line yet shows as a preview row tagged
   * "Next bar"; taps then edit the preview (the pattern you'll hear next).
   */
  function renderBeats() {
    const target = currentPattern();
    const running = isRunning();
    const shown = running && eng.soundingPattern ? eng.soundingPattern : target;
    const preview = running && patternKey(shown) !== patternKey(target) ? target : null;
    drawBeatRow($("beats"), shown, !preview);
    $("beats-next").hidden = !preview;
    if (preview) {
      drawBeatRow($("beats-preview"), preview, true);
      $("next-tag").textContent = `Next bar · ${describePattern(preview)}`;
    }
  }
  function drawBeatRow(wrap, pattern, editable) {
    const meter = pattern.meter;
    const key = `${patternKey(pattern)}|${editable}`;
    if (wrap.dataset.key === key) return;
    wrap.dataset.key = key;
    wrap.textContent = "";
    meter.grouping.forEach((size, gi) => {
      const group = document.createElement("div");
      group.className = "beat-group";
      for (let j = 0; j < size; j++) {
        const unit = meter.groupStarts[gi] + j;
        const level = pattern.accents[unit];
        const b = document.createElement("button");
        b.type = "button";
        b.className = "beat";
        b.dataset.unit = String(unit);
        b.dataset.level = T.LEVEL_NAMES[level];
        b.disabled = !editable;
        b.setAttribute("aria-label", `Beat ${unit + 1}: ${describeLevel(level)}.${editable ? " Tap to change." : ""}`);
        group.append(b);
      }
      wrap.append(group);
    });
    if (wrap.id === "beats") renderActiveBeat();
  }
  function renderActiveBeat() {
    for (const b of $("beats").children) for (const dot of b.children) {
      const on = Number(dot.dataset.unit) === eng.currentUnit;
      dot.classList.toggle("on", on);
      if (on) dot.dataset.role = eng.currentRole || "music";
    }
  }
  const describeLevel = (l) => ({ [L.downbeat]: "strong accent", [L.group]: "group accent", [L.normal]: "normal", [L.muted]: "silent" })[l];

  function chip(container, items, isOn, onPick) {
    const el = $(container);
    el.textContent = "";
    for (const item of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", String(isOn(item)));
      b.innerHTML = "";
      b.append(document.createTextNode(item.label));
      if (item.note) { const s = document.createElement("small"); s.textContent = item.note; b.append(s); }
      b.addEventListener("click", () => { onPick(item); renderSetup(); saveStore(); });
      el.append(b);
    }
  }
  function renderSetup() {
    chip("meter-chips", METERS.map((m) => ({ ...m, label: m.label || m.id })), (m) => m.id === settings.meterId, (m) => {
      if (m.id === settings.meterId) return;
      settings.meterId = m.id;
      settings.accents = null;
      renderTempo(); queueChange("pattern"); renderBeats();
    });
    const subNames = { 1: "off", 2: "÷2", 3: "÷3", 4: "÷4", 5: "÷5", 6: "÷6", 7: "÷7" };
    chip("sub-chips", SUBDIVISIONS.map((n) => ({ id: n, label: n === 1 ? "Off" : subNames[n] })), (s) => s.id === settings.subdivision, (s) => {
      settings.subdivision = s.id; queueChange("pattern"); renderBeats();
    });
    chip("countin-chips", COUNT_IN_MODES, (c) => c.id === settings.countInMode, (c) => { settings.countInMode = c.id; });
    chip("countin-bars-chips", COUNT_IN_BARS.map((n) => ({ id: n, label: `${n} bar${n > 1 ? "s" : ""}` })), (c) => c.id === settings.countInBars, (c) => { settings.countInBars = c.id; });
    $("countin-bars").hidden = settings.countInMode === "off";
    chip("tempo-change-chips", TEMPO_CHANGE, (t) => t.id === settings.tempoChange, (t) => { settings.tempoChange = t.id; log(`Tempo changes land on: ${t.label}`); });
    renderLcd();
    chip("concept-chips", CONCEPTS, (c) => c.id === settings.concept, (c) => {
      if (c.id === settings.concept) return;
      settings.concept = c.id;
      applyConcept();
      log(`Design concept: ${c.label} (${c.name})`);
    });
    chip("sound-chips", SOUNDS, (s) => s.id === settings.sound, (s) => { settings.sound = s.id; });
    chip("awake-chips", [{ id: "off", label: "Off" }, { id: "playing", label: "While playing" }, { id: "always", label: "Always" }],
      (a) => a.id === settings.awake, (a) => {
        if (a.id === settings.awake) return;
        settings.awake = a.id;
        log(`Keep screen awake: ${a.label}`);
        renderAwake();
        updateAwake();
      });
  }

  function envInfo() {
    const ctx = eng.ctx;
    const standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    return {
      "Browser": BROWSER.label,
      "Version": IS_PWA ? "Home-screen build" : "Preview",
      "Design concept": CONCEPTS.find((c) => c.id === settings.concept).label,
      "Opened from": standalone ? "Home Screen" : "Browser",
      "Offline copy": offlineStatus,
      "Sample rate": ctx ? `${ctx.sampleRate} Hz` : "starts with audio",
      "Base latency": ctx ? ms(ctx.baseLatency) : "–",
      "Output latency": ctx ? ms(ctx.outputLatency) : "–",
      "Audio session": navigator.audioSession ? navigator.audioSession.type : "not supported",
      "Plays in silent mode": silentModeStatus(),
      "Screen wake lock": "wakeLock" in navigator ? "supported" : "not supported",
      "Keeping screen awake": { wakeLock: "yes (Wake Lock)", video: "yes (silent video)", needsTap: "needs a tap", unavailable: "not possible", off: "no" }[awakeState.method],
    };
  }
  function renderMetrics() {
    const running = eng.status === "playing" || eng.status === "countIn";
    const runSeconds = stats.runSeconds + (running && eng.runStartPerf ? (performance.now() - eng.runStartPerf) / 1000 : 0);
    const rows = [
      ["Play time", fmtClock(runSeconds), ""],
      ["Clicks scheduled", String(stats.scheduled), ""],
      ["Missed clicks", String(stats.missed), stats.missed ? "bad" : stats.scheduled ? "good" : ""],
      ["Worst timer gap", stats.worstGapVisible ? `${stats.worstGapVisible.toFixed(0)} ms` : "–", stats.worstGapVisible > LOOKAHEAD * 1000 ? "bad" : ""],
      ["Worst gap, hidden", stats.worstGapHidden ? `${stats.worstGapHidden.toFixed(0)} ms` : "–", stats.worstGapHidden > LOOKAHEAD * 1000 ? "bad" : ""],
      ["Tightest lead", Number.isFinite(stats.minHeadroom) ? `${(stats.minHeadroom * 1000).toFixed(1)} ms` : "–", ""],
      ["Audio vs system clock", stats.driftPpm === null ? "needs 10 s" : `${stats.driftPpm >= 0 ? "+" : ""}${stats.driftPpm.toFixed(1)} ppm`, ""],
      ["Interruptions", String(stats.interruptions), stats.interruptions ? "bad" : ""],
      ...Object.entries(envInfo()).map(([k, v]) => [k, v, ""]),
    ];
    const dl = $("metrics");
    if (dl.children.length !== rows.length) {
      dl.textContent = "";
      for (const [k] of rows) {
        const div = document.createElement("div");
        div.className = "metric";
        const dt = document.createElement("dt"); dt.textContent = k;
        const dd = document.createElement("dd");
        div.append(dt, dd);
        dl.append(div);
      }
    }
    rows.forEach(([, v, cls], i) => {
      const dd = dl.children[i].querySelector("dd");
      if (dd.textContent !== v) dd.textContent = v;
      dd.className = cls;
    });
  }

  function renderChecks() {
    const wrap = $("checks");
    wrap.textContent = "";
    for (const c of CHECKS) {
      const box = document.createElement("div");
      box.className = "check";
      const h = document.createElement("h3"); h.textContent = c.title;
      const p = document.createElement("p"); p.textContent = c.text;
      const rows = document.createElement("div"); rows.className = "check-rows";
      for (const r of c.rows) {
        const row = document.createElement("div"); row.className = "check-row";
        const id = `check-${r.id}`;
        const label = document.createElement("label"); label.htmlFor = id; label.textContent = r.label;
        const sel = document.createElement("select"); sel.id = id;
        for (const o of r.options) { const opt = document.createElement("option"); opt.textContent = o; sel.append(opt); }
        sel.value = answers[r.id] || r.options[0];
        sel.addEventListener("change", () => { answers[r.id] = sel.value; log(`Result recorded: ${r.label} → ${sel.value}`); saveStore(); });
        row.append(label, sel);
        rows.append(row);
      }
      box.append(h, p, rows);
      wrap.append(box);
    }
  }

  function buildReport() {
    const lines = ["POCKET web test report", `Generated: ${new Date().toString()}`, `Browser: ${BROWSER.label}`, `User agent: ${navigator.userAgent}`, ""];
    lines.push("Environment");
    for (const [k, v] of Object.entries(envInfo())) lines.push(`  ${k}: ${v}`);
    lines.push("", "Counters");
    const runSeconds = stats.runSeconds + (eng.runStartPerf ? (performance.now() - eng.runStartPerf) / 1000 : 0);
    lines.push(`  Play time: ${fmtClock(runSeconds)} (${stats.starts} starts)`);
    lines.push(`  Clicks scheduled: ${stats.scheduled}`);
    lines.push(`  Missed clicks: ${stats.missed} in ${stats.missEvents} incidents`);
    lines.push(`  Worst timer gap visible / hidden: ${stats.worstGapVisible.toFixed(0)} / ${stats.worstGapHidden.toFixed(0)} ms (lookahead ${LOOKAHEAD * 1000} ms)`);
    lines.push(`  Tightest lead: ${Number.isFinite(stats.minHeadroom) ? (stats.minHeadroom * 1000).toFixed(1) + " ms" : "n/a"}`);
    lines.push(`  Audio vs system clock: ${stats.driftPpm === null ? "n/a" : stats.driftPpm.toFixed(1) + " ppm"}`);
    lines.push(`  Interruptions: ${stats.interruptions}`);
    lines.push(`  Settings: ${fmtBpm(settings.bpm)} BPM, ${currentMeter().label}, subdivision ${settings.subdivision}, count-in ${settings.countInMode} (${settings.countInBars} bar), tempo changes on next ${settings.tempoChange}, ${settings.sound}, volume ${settings.volume}%, keep screen awake ${settings.awake}, stop on output change ${settings.routeStop}, play in silent mode ${settings.playOnSilent}`);
    lines.push("", "Checklist");
    for (const c of CHECKS) for (const r of c.rows) lines.push(`  ${r.label}: ${answers[r.id] || "Not tried"}`);
    lines.push("", "Notes", `  ${$("notes").value.trim() || "(none)"}`, "", "Event log (oldest first)");
    for (const e of logEntries) lines.push(`  ${e.at.slice(11, 19)} [${e.status}] ${e.message}`);
    return lines.join("\n");
  }

  // ---------- controls ----------
  function setBpm(v) {
    const next = clampBpm(v);
    if (next === settings.bpm) { renderTempo(); return; }
    settings.bpm = next;
    renderTempo();
    renderTempoNote();
    queueChange("tempo");
    saveStore();
  }

  $("start").addEventListener("click", () => (isRunning() ? stop() : eng.status === "paused" ? start(true) : start()));
  $("pause").addEventListener("click", () => (isRunning() ? pause() : eng.status === "paused" ? stop() : null));
  $("banner-dismiss").addEventListener("click", () => { hideBanner(); if (eng.status === "interrupted") setStatus("idle"); });
  // Nudges. ±1 repeats while held: after 400 ms, 8 steps a second, no
  // acceleration; stops when the finger lifts or slides off (Docs/UX.md J3).
  const HOLD_DELAY = 400;
  const HOLD_RATE = 125;
  const nudge = (b) => setBpm(Math.round(settings.bpm) + Number(b.dataset.nudge));
  let hold = null;
  function endHold() {
    if (!hold) return;
    clearTimeout(hold.timer);
    clearInterval(hold.repeat);
    hold = null;
  }
  document.querySelectorAll("[data-nudge]").forEach((b) => {
    const repeats = Math.abs(Number(b.dataset.nudge)) === 1;
    b.addEventListener("click", (e) => {
      // Pointer presses already stepped on pointerdown; this handles keyboard and ±5.
      if (repeats && e.detail !== 0) return;
      nudge(b);
    });
    if (!repeats) return;
    b.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      endHold();
      // Touch captures the pointer implicitly; release it so sliding off ends the hold.
      if (b.hasPointerCapture && b.hasPointerCapture(e.pointerId)) b.releasePointerCapture(e.pointerId);
      nudge(b);
      hold = { timer: setTimeout(() => { if (hold) hold.repeat = setInterval(() => nudge(b), HOLD_RATE); }, HOLD_DELAY) };
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) b.addEventListener(type, endHold);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  });
  window.addEventListener("blur", endHold);

  const taps = [];
  $("tap").addEventListener("click", () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 2) {
      const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      setBpm(Math.round(60000 / avg));
    } else {
      const note = $("tempo-note");
      note.classList.remove("error");
      note.textContent = "Tap again";
    }
  });

  const bpmDisplay = $("bpm-display");
  const bpmInput = $("bpm-input");
  bpmDisplay.addEventListener("click", () => {
    bpmInput.value = fmtBpm(settings.bpm);
    bpmDisplay.hidden = true;
    bpmInput.hidden = false;
    bpmInput.focus();
    bpmInput.select();
  });
  function closeBpmEdit(commit) {
    if (bpmInput.hidden) return;
    if (commit) {
      const v = Number(bpmInput.value.replace(",", "."));
      if (!Number.isFinite(v) || v < T.TEMPO_MIN || v > T.TEMPO_MAX) {
        renderTempoNote(`Enter a tempo from ${T.TEMPO_MIN} to ${T.TEMPO_MAX}.`);
        bpmInput.focus();
        return;
      }
      setBpm(v);
    }
    bpmInput.hidden = true;
    bpmDisplay.hidden = false;
    renderTempoNote();
  }
  bpmInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); closeBpmEdit(true); }
    if (e.key === "Escape") { e.preventDefault(); closeBpmEdit(false); }
  });
  bpmInput.addEventListener("blur", () => closeBpmEdit(true));

  function onBeatTap(e) {
    const dot = e.target.closest(".beat");
    if (!dot || dot.disabled) return;
    const meter = currentMeter();
    const accents = currentAccents(meter).slice();
    const unit = Number(dot.dataset.unit);
    accents[unit] = CYCLE[(CYCLE.indexOf(accents[unit]) + 1) % CYCLE.length];
    settings.accents = accents;
    queueChange("pattern");
    renderBeats();
    renderActiveBeat();
    saveStore();
  }
  $("beats").addEventListener("click", onBeatTap);
  $("beats-preview").addEventListener("click", onBeatTap);

  $("volume").value = String(settings.volume);
  $("volume-out").textContent = `${settings.volume}%`;
  $("volume").addEventListener("input", (e) => {
    settings.volume = Number(e.target.value);
    $("volume-out").textContent = `${settings.volume}%`;
    if (eng.master) eng.master.gain.setTargetAtTime(volumeGain(settings.volume), eng.ctx.currentTime, 0.015);
    saveStore();
  });
  $("opt-silent").checked = settings.playOnSilent;
  $("opt-silent").addEventListener("change", (e) => {
    settings.playOnSilent = e.target.checked;
    log(`Play in silent mode: ${settings.playOnSilent ? "on" : "off"} (applies from the next Start)`);
    setAudioSession();
    if (!settings.playOnSilent) stopSilentTrack();
    saveStore();
  });
  $("opt-route").checked = settings.routeStop;
  $("opt-route").addEventListener("change", (e) => { settings.routeStop = e.target.checked; saveStore(); });
  $("notes").value = stored.notes || "";
  $("notes").addEventListener("input", saveStore);

  $("copy-report").addEventListener("click", () => {
    const text = buildReport();
    const fallback = () => {
      const ta = $("report-fallback");
      ta.value = text;
      ta.hidden = false;
      ta.focus();
      ta.select();
      $("copy-report").textContent = "Select all and copy";
    };
    try {
      navigator.clipboard.writeText(text).then(() => {
        $("copy-report").textContent = "Copied";
        setTimeout(() => ($("copy-report").textContent = "Copy report"), 2000);
      }, fallback);
    } catch { fallback(); }
  });
  $("reset-stats").addEventListener("click", () => {
    Object.assign(stats, freshStats());
    if (eng.runStartPerf) eng.runStartPerf = performance.now();
    log("Counters reset");
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.target.closest("input, textarea, select, button")) {
      e.preventDefault();
      $("start").click();
    }
  });

  // ---------- offline (home-screen build only) ----------
  let offlineStatus = IS_PWA ? "checking…" : "needs home-screen build";
  if (IS_PWA && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      const done = () => { offlineStatus = "ready"; log("Offline copy saved on this device", "info"); };
      if (reg.active) offlineStatus = "ready";
      else {
        const w = reg.installing || reg.waiting;
        if (w) w.addEventListener("statechange", () => { if (w.state === "activated") done(); });
      }
    }).catch((e) => { offlineStatus = "failed"; log(`Offline copy failed: ${e.message}`, "warn"); });
  } else if (IS_PWA) {
    offlineStatus = "not supported";
  }

  // ---------- console readout (concept D) ----------
  const NOTE_NAMES = { 1: "Whole", 2: "Half", 4: "Quarter", 8: "Eighth", 16: "Sixteenth", 32: "Thirty-second" };
  function subdivisionName(pattern) {
    const den = pattern.meter.den;
    const unit = NOTE_NAMES[den] || `1/${den}`;
    const sub = pattern.subdivision;
    if (sub === 1) return unit;
    const finer = { 2: NOTE_NAMES[den * 2], 4: NOTE_NAMES[den * 4], 8: NOTE_NAMES[den * 8] }[sub];
    const tuplet = { 3: "Triplet", 5: "Quintuplet", 6: "Sextuplet", 7: "Septuplet" }[sub];
    return `${unit} + ${finer || tuplet || `÷${sub}`}`;
  }
  function renderLcd() {
    const pattern = currentPattern();
    const meter = pattern.meter;
    const grouping = meter.grouping.some((g) => g > 1) && !meter.compound ? ` (${meter.grouping.join("+")})` : "";
    $("lcd-meter").textContent = `${meter.num}/${meter.den}${grouping} time`;
    const countIn = settings.countInMode === "off" ? "No count-in" : `Count-in ${settings.countInBars} bar${settings.countInBars > 1 ? "s" : ""}`;
    $("lcd-pattern").textContent = `${subdivisionName(pattern)} · ${settings.sound} · ${countIn}`;
    const bar = eng.currentBar === null ? null : eng.currentBar + eng.barOffset + 1;
    $("lcd-state").textContent = {
      idle: "Ready at bar 1",
      countIn: "Count-in",
      playing: bar ? `Playing · bar ${bar}` : "Playing",
      paused: `Paused · resumes at bar ${eng.barOffset + 1}`,
      interrupted: "Stopped by the system",
    }[eng.status];
    $("status-meta").textContent = `${eng.ctx ? eng.ctx.sampleRate / 1000 + " kHz" : "Audio off"} · Web Audio clock · settings saved on this device`;
  }

  // ---------- design concepts ----------
  function applyConcept() {
    document.documentElement.dataset.concept = settings.concept;
    saveStore();
  }
  $("stage-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const open = !("stageOpen" in root.dataset);
    if (open) root.dataset.stageOpen = ""; else delete root.dataset.stageOpen;
    $("stage-toggle").setAttribute("aria-expanded", String(open));
    $("stage-toggle").textContent = open ? "Hide setup and test results" : "Show setup and test results";
  });

  // Tempo dial (concept B): drag up or right to speed up, 4 px per BPM.
  // The pointer sweeps 270° across 20–300 BPM. Arrow keys ±1, Page Up/Down ±5.
  const DIAL_SWEEP = 270;
  function buildDial() {
    const ns = "http://www.w3.org/2000/svg";
    const el = (name, attrs) => { const n = document.createElementNS(ns, name); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
    const svg = el("svg", { viewBox: "-60 -60 120 120", "aria-hidden": "true" });
    const defs = el("defs", {});
    const grad = el("radialGradient", { id: "dial-knob", cx: "45%", cy: "35%", r: "75%" });
    grad.append(el("stop", { offset: "0%", "stop-color": "#4a443b" }), el("stop", { offset: "100%", "stop-color": "#1f1c18" }));
    defs.append(grad);
    svg.append(defs);
    for (let i = 0; i <= 28; i++) {
      const bpm = 20 + i * 10;
      const a = ((-DIAL_SWEEP / 2 + (i / 28) * DIAL_SWEEP) - 90) * (Math.PI / 180);
      const major = bpm % 50 === 0 || bpm === 20;
      const r1 = major ? 46 : 48, r2 = 53;
      svg.append(el("line", { class: `tick${major ? " major" : ""}`, x1: r1 * Math.cos(a), y1: r1 * Math.sin(a), x2: r2 * Math.cos(a), y2: r2 * Math.sin(a) }));
      if (bpm === 20 || bpm === 100 || bpm === 200 || bpm === 300) {
        svg.append(Object.assign(el("text", { class: "tick-label", x: 60 * Math.cos(a), y: 60 * Math.sin(a) }), { textContent: String(bpm) }));
      }
    }
    svg.append(el("circle", { class: "knob", r: 40 }));
    for (const r of [34, 28]) svg.append(el("circle", { class: "grip", r }));
    const pointer = el("g", { id: "dial-pointer" });
    pointer.append(el("line", { class: "pointer", x1: 0, y1: -18, x2: 0, y2: -36 }));
    svg.append(pointer);
    $("dial").append(svg);
  }
  function renderDial(bpm) {
    const pointer = document.getElementById("dial-pointer");
    if (!pointer) return;
    const angle = -DIAL_SWEEP / 2 + ((bpm - T.TEMPO_MIN) / (T.TEMPO_MAX - T.TEMPO_MIN)) * DIAL_SWEEP;
    pointer.setAttribute("transform", `rotate(${angle.toFixed(2)})`);
    const dial = $("dial");
    dial.setAttribute("aria-valuenow", String(bpm));
    dial.setAttribute("aria-valuetext", `${fmtBpm(bpm)} BPM`);
  }
  (function wireDial() {
    const dial = $("dial");
    let drag = null;
    dial.addEventListener("pointerdown", (e) => {
      dial.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, start: Math.round(settings.bpm) };
    });
    dial.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const moved = (drag.y - e.clientY) + (e.clientX - drag.x);
      const next = drag.start + Math.trunc(moved / 4);
      if (next !== Math.round(settings.bpm)) setBpm(next);
    });
    for (const type of ["pointerup", "pointercancel"]) dial.addEventListener(type, () => { drag = null; });
    dial.addEventListener("keydown", (e) => {
      const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
      if (step) { e.preventDefault(); setBpm(Math.round(settings.bpm) + step); }
      if (e.key === "Home") { e.preventDefault(); setBpm(T.TEMPO_MIN); }
      if (e.key === "End") { e.preventDefault(); setBpm(T.TEMPO_MAX); }
    });
  })();

  // ---------- boot ----------
  buildDial();
  applyConcept();
  renderTempo();
  renderBeats();
  renderSetup();
  renderChecks();
  renderMetrics();
  renderAwake();
  updateAwake();
  setInterval(renderMetrics, 500);
  requestAnimationFrame(frame);
  log(`Loaded ${IS_PWA ? "home-screen build" : "preview"} in ${BROWSER.label}. Press Start to enable audio.`);
})();
