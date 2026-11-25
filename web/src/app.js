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
  const COUNT_INS = [0, 1, 2];
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
      id: "offline", title: "3 · Offline from the Home Screen",
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
        countIn: settings.countIn, sound: settings.sound, volume: settings.volume,
        awake: settings.awake, routeStop: settings.routeStop, answers, notes: $("notes").value,
      }));
    } catch { /* storage unavailable: fine */ }
  }
  const stored = loadStore();

  const settings = {
    bpm: clampBpm(stored.bpm ?? 112),
    meterId: METERS.some((m) => m.id === stored.meterId) ? stored.meterId : "4/4",
    accents: Array.isArray(stored.accents) ? stored.accents : null,
    subdivision: SUBDIVISIONS.includes(stored.subdivision) ? stored.subdivision : 1,
    countIn: COUNT_INS.includes(stored.countIn) ? stored.countIn : 1,
    sound: SOUNDS.some((s) => s.id === stored.sound) ? stored.sound : "wood",
    volume: Number.isFinite(stored.volume) ? stored.volume : 60,
    awake: ["off", "playing", "always"].includes(stored.awake) ? stored.awake : stored.wake === false ? "off" : "always",
    routeStop: stored.routeStop ?? true,
  };
  const answers = stored.answers || {};

  // ---------- engine state ----------
  const eng = {
    status: "idle",          // idle | countIn | playing | interrupted
    ctx: null, master: null, buffers: null,
    plan: null, scheduledUntil: 0, sources: new Set(), visual: [],
    pending: null, queuedBar: null,
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
    const list = $("log");
    list.prepend(li);
    while (list.children.length > 200) list.lastChild.remove();
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

  function setAudioSession() {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== "playback") {
        navigator.audioSession.type = "playback";
        log("Audio session set to playback (plays with the silent switch on)", "info");
      }
    } catch (e) { log(`Could not set audio session: ${e.message}`, "warn"); }
  }

  // ---------- transport ----------
  async function start() {
    if (eng.status === "playing" || eng.status === "countIn") return;
    hideBanner();
    try {
      setAudioSession();
      ensureAudio();
      if (eng.ctx.state !== "running") await eng.ctx.resume();
      if (eng.ctx.state !== "running") throw new Error(`audio is ${eng.ctx.state}`);
      const pattern = currentPattern();
      const tempo = currentTempo();
      eng.plan = T.PlaybackPlan.click({ pattern, tempo, countInBars: settings.countIn, startTime: eng.ctx.currentTime + START_DELAY });
      eng.scheduledUntil = eng.plan.startTime;
      eng.visual = [];
      eng.pending = null;
      eng.queuedBar = null;
      eng.runStartPerf = performance.now();
      eng.lastTick = performance.now();
      eng.clockRef = null;
      eng.countInBars = settings.countIn;
      eng.currentBar = null;
      stats.starts++;
      setStatus(settings.countIn > 0 ? "countIn" : "playing");
      log(`Start: ${fmtBpm(tempo.bpm)} BPM, ${pattern.meter.label}, subdivision ${pattern.subdivision}, count-in ${settings.countIn}`);
      startTimer();
      schedule();
    } catch (err) {
      setStatus("idle");
      log(`Start failed: ${err.message}`, "warn");
      showBanner(`Audio could not start (${err.message}). Check the volume and silent mode, then press Start again.`);
    }
  }

  function stop(reason, kind = "user") {
    if (eng.status === "idle" || eng.status === "interrupted") { if (!reason) return; }
    stopTimer();
    for (const src of eng.sources) { try { src.stop(); } catch { /* already stopped */ } }
    eng.sources.clear();
    eng.visual = [];
    eng.pending = null;
    eng.queuedBar = null;
    if (eng.runStartPerf) stats.runSeconds += (performance.now() - eng.runStartPerf) / 1000;
    eng.runStartPerf = 0;
    if (reason) {
      stats.interruptions++;
      setStatus("interrupted");
      showBanner(reason);
      log(`Stopped: ${reason}`, "warn");
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
    pill.textContent = { idle: "Ready", countIn: "Count-in", playing: "Running", interrupted: "Interrupted" }[s];
    const btn = $("start");
    const running = s === "playing" || s === "countIn";
    btn.dataset.running = String(running);
    btn.textContent = running ? "Stop" : "Start";
    if (!running) { eng.currentUnit = -1; renderActiveBeat(); }
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
      eng.visual.push(e);
      stats.scheduled++;
      stats.minHeadroom = Math.min(stats.minHeadroom, e.time - now);
    }
    eng.scheduledUntil = to;
  }

  /** Apply queued tempo/pattern changes from the first bar not yet scheduled. */
  function applyPending() {
    if (!eng.pending) return;
    const bar = eng.plan.firstBarAtOrAfter(eng.scheduledUntil);
    if (bar === null) return;
    const { tempo, pattern } = eng.pending;
    eng.plan = eng.plan.changing(bar, (s) => ({ ...s, tempo, pattern: s.role === "music" ? pattern : s.pattern }));
    eng.pending = null;
    eng.queuedBar = bar;
    log(`Change queued for bar ${bar + 1}: ${fmtBpm(tempo.bpm)} BPM, ${pattern.meter.label}, subdivision ${pattern.subdivision}`);
    renderTempoNote();
  }

  function queueChange() {
    if (eng.status === "playing" || eng.status === "countIn") {
      eng.pending = { tempo: currentTempo(), pattern: currentPattern() };
      renderTempoNote();
    }
  }

  // ---------- system events ----------
  function onAudioState() {
    const st = eng.ctx.state;
    log(`Audio state: ${st}`, st === "running" ? "info" : "warn");
    if ((eng.status === "playing" || eng.status === "countIn") && st !== "running") {
      stop(`Audio was interrupted (${st}). It will not restart on its own. Press Start when you're ready.`);
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
      const missed = stats.missed - eng.missedAtHide;
      log(`Page visible after ${away} s; ${missed} clicks missed while away; audio ${eng.ctx ? eng.ctx.state : "not started"}`, missed ? "warn" : "info");
      eng.hiddenAt = null;
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
        stop("The audio output changed. Playback stopped so it doesn't continue on the wrong device. Press Start to continue.");
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
    const running = eng.status === "playing" || eng.status === "countIn";
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
      if (latest && latest.sub === 0) {
        eng.currentUnit = latest.unit;
        eng.currentRole = latest.role;
        eng.currentBar = latest.bar;
        if (latest.role === "music" && eng.status === "countIn") setStatus("playing");
        if (eng.queuedBar !== null && latest.bar >= eng.queuedBar) { eng.queuedBar = null; renderTempoNote(); }
        renderBeats();
        renderActiveBeat();
      }
      const elapsed = (performance.now() - eng.runStartPerf) / 1000;
      $("pos-time").textContent = fmtClock(elapsed);
      $("pos-bar").textContent = eng.currentBar === null ? "Bar –" : eng.currentBar < 0 ? `Count-in ${eng.currentBar + eng.countInBars + 1}` : `Bar ${eng.currentBar + 1}`;
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
  }
  function renderTempoNote(error) {
    const note = $("tempo-note");
    note.classList.toggle("error", !!error);
    if (error) { note.textContent = error; return; }
    if (eng.pending) note.textContent = `Next bar: ${fmtBpm(eng.pending.tempo.bpm)} BPM`;
    else if (eng.queuedBar !== null) note.textContent = `Changes at bar ${eng.queuedBar + 1}`;
    else note.textContent = "";
  }

  function renderBeats() {
    const meter = currentMeter();
    const accents = currentAccents(meter);
    const wrap = $("beats");
    const key = `${meter.label}|${meter.grouping}|${accents}`;
    if (wrap.dataset.key !== key) {
      wrap.dataset.key = key;
      wrap.textContent = "";
      meter.grouping.forEach((size, gi) => {
        const group = document.createElement("div");
        group.className = "beat-group";
        for (let j = 0; j < size; j++) {
          const unit = meter.groupStarts[gi] + j;
          const b = document.createElement("button");
          b.type = "button";
          b.className = "beat";
          b.dataset.unit = String(unit);
          b.dataset.level = T.LEVEL_NAMES[accents[unit]];
          b.setAttribute("aria-label", `Beat ${unit + 1}: ${describeLevel(accents[unit])}. Tap to change.`);
          group.append(b);
        }
        wrap.append(group);
      });
    }
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
      renderTempo(); renderBeats(); queueChange();
    });
    const subNames = { 1: "off", 2: "÷2", 3: "÷3", 4: "÷4", 5: "÷5", 6: "÷6", 7: "÷7" };
    chip("sub-chips", SUBDIVISIONS.map((n) => ({ id: n, label: n === 1 ? "Off" : subNames[n] })), (s) => s.id === settings.subdivision, (s) => {
      settings.subdivision = s.id; queueChange();
    });
    chip("countin-chips", COUNT_INS.map((n) => ({ id: n, label: n === 0 ? "None" : `${n} bar${n > 1 ? "s" : ""}` })), (c) => c.id === settings.countIn, (c) => { settings.countIn = c.id; });
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
      "Opened from": standalone ? "Home Screen" : "Browser",
      "Offline copy": offlineStatus,
      "Sample rate": ctx ? `${ctx.sampleRate} Hz` : "starts with audio",
      "Base latency": ctx ? ms(ctx.baseLatency) : "–",
      "Output latency": ctx ? ms(ctx.outputLatency) : "–",
      "Audio session": navigator.audioSession ? navigator.audioSession.type : "not supported",
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
    lines.push(`  Settings: ${fmtBpm(settings.bpm)} BPM, ${currentMeter().label}, subdivision ${settings.subdivision}, count-in ${settings.countIn}, ${settings.sound}, volume ${settings.volume}%, keep screen awake ${settings.awake}, stop on output change ${settings.routeStop}`);
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
    queueChange();
    saveStore();
  }

  $("start").addEventListener("click", () => (eng.status === "playing" || eng.status === "countIn" ? stop() : start()));
  $("banner-dismiss").addEventListener("click", () => { hideBanner(); if (eng.status === "interrupted") setStatus("idle"); });
  document.querySelectorAll("[data-nudge]").forEach((b) => b.addEventListener("click", () => setBpm(Math.round(settings.bpm) + Number(b.dataset.nudge))));

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
      renderTempoNote("Keep tapping…");
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

  $("beats").addEventListener("click", (e) => {
    const dot = e.target.closest(".beat");
    if (!dot) return;
    const meter = currentMeter();
    const accents = currentAccents(meter).slice();
    const unit = Number(dot.dataset.unit);
    accents[unit] = CYCLE[(CYCLE.indexOf(accents[unit]) + 1) % CYCLE.length];
    settings.accents = accents;
    renderBeats();
    renderActiveBeat();
    queueChange();
    saveStore();
  });

  $("volume").value = String(settings.volume);
  $("volume-out").textContent = `${settings.volume}%`;
  $("volume").addEventListener("input", (e) => {
    settings.volume = Number(e.target.value);
    $("volume-out").textContent = `${settings.volume}%`;
    if (eng.master) eng.master.gain.setTargetAtTime(volumeGain(settings.volume), eng.ctx.currentTime, 0.015);
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

  // ---------- boot ----------
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
