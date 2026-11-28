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
    { id: "a", label: "A · Studio", name: "Studio instrument", note: "Graphite and amber, flat modules, workspace rail" },
    { id: "b", label: "B · Workshop", name: "Analog workshop", note: "Warm hardware, ivory labels, indicator lamps, tempo dial" },
    { id: "c", label: "C · Stage", name: "Minimal stage", note: "Huge numbers, big keys, nothing else on screen" },
    { id: "d", label: "D · Console", name: "Hardware console (owner reference)", note: "Green display, coloured keys, knob, status strip" },
  ];
  // Where a tempo change lands while playing. "now" = the next click (owner, 2026-11-26).
  const TEMPO_CHANGE = [{ id: "now", label: "Immediately" }, { id: "beat", label: "Next beat" }, { id: "bar", label: "Next bar" }];
  const SND = window.PocketSounds;
  // Recorded kits (CC0 samples bundled by web/build.mjs) first, then synthesized ones.
  const SAMPLE_KITS = (window.POCKET_SAMPLE_KITS || []).map((k) => ({ ...k, recorded: true }));
  const SYNTH_KITS = SND.KITS.map((k) => ({ ...k, recorded: false }));
  const SOUNDS = SAMPLE_KITS.concat(SYNTH_KITS);
  /** Sounds you added (Settings › Sound › Your sounds), loaded from IndexedDB after start-up. */
  let userKits = [];
  const allSounds = () => SOUNDS.concat(userKits);
  const isUserSoundId = (id) => typeof id === "string" && id.startsWith("user-");
  const CYCLE = [L.downbeat, L.group, L.normal, L.muted];

  const CHECKS = [
    {
      id: "steady", title: "1 · Steady for 30 minutes",
      text: "Wired headphones, your practice tempo, screen on. Let it run 30 minutes. It passes if it sounds steady and Missed clicks stays at 0. To compare browsers, run the checks in each one (Safari, Chrome) and copy a report from each.",
      rows: [
        { id: "steady", label: "30-minute run", options: ["Not tried", "Steady, 0 missed", "Heard a glitch", "Missed clicks"] },
        { id: "ladder", label: "Practice ladder runs start to finish with correct stage changes", options: ["Not tried", "Worked", "A stage change was wrong", "Something else (see notes)"] },
      ],
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
    if (typeof renderPresetCurrent === "function" && document.getElementById("preset-name")) { try { renderPresetCurrent(); } catch { /* not ready yet */ } }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        bpm: settings.bpm, meterId: settings.meterId, accents: settings.accents, subdivision: settings.subdivision,
        countInMode: settings.countInMode, countInBars: settings.countInBars, tempoChange: settings.tempoChange, tempoChangeV: 2, sound: settings.sound, volume: settings.volume,
        accentStyle: settings.accentStyle, countInSound: settings.countInSound, subVolume: settings.subVolume,
        awake: settings.awake, routeStop: settings.routeStop, playOnSilent: settings.playOnSilent, concept: settings.concept, settingsTab: settings.settingsTab,
        workspace: settings.workspace, routines, routineId, routineWorking: routineCfg, sessions, presets, presetId: settings.presetId,
        gapMode: settings.gapMode, gapPlay: settings.gapPlay, gapMute: settings.gapMute, gapPercent: settings.gapPercent, gapSeed: settings.gapSeed, gapHideLights: settings.gapHideLights, swing: settings.swing, layout: settings.layout, tempoLock: settings.tempoLock, presetNotes,
        grooveOn: settings.grooveOn, grooveId: settings.grooveId, kickVoice: settings.kickVoice, grooveLanes: settings.grooveLanes, mix: settings.mix, userGrooves, answers, notes: $("notes").value,
      }));
    } catch { /* storage unavailable: fine */ }
  }
  const stored = loadStore();

  // Steps follow the drum-machine convention (Roger Linn / Akai MPC): 50 straight,
  // 54–70 in steps of 4, 67 ≈ exact triplet feel (2:1), 75 the usual maximum.
  const SWING_CHOICES_IDS = [50, 54, 58, 62, 67, 70, 75];
  // Earlier builds used 55, 60 and 72; map them to the nearest standard step.
  const SWING_LEGACY = { 55: 54, 60: 58, 72: 70 };
  const settings = {
    bpm: clampBpm(stored.bpm ?? 120),
    meterId: METERS.some((m) => m.id === stored.meterId) ? stored.meterId : "4/4",
    accents: Array.isArray(stored.accents) ? stored.accents : null,
    subdivision: SUBDIVISIONS.includes(stored.subdivision) ? stored.subdivision : 1,
    // Count-in: when it plays (every start incl. resume / first start after opening / off) and how long.
    countInMode: COUNT_IN_MODES.some((m) => m.id === stored.countInMode) ? stored.countInMode : stored.countIn === 0 ? "off" : "every",
    countInBars: COUNT_IN_BARS.includes(stored.countInBars) ? stored.countInBars : COUNT_IN_BARS.includes(stored.countIn) ? stored.countIn : 1,
    // Where a tempo change lands while playing (Docs/UX.md O-1): next beat by default.
    // "beat" was the previous default; move it to the new default once.
    tempoChange: stored.tempoChangeV === 2 && TEMPO_CHANGE.some((t) => t.id === stored.tempoChange) ? stored.tempoChange
      : stored.tempoChange === "bar" ? "bar" : "now",
    // A sound you added loads a moment later (IndexedDB); keep its id until then.
    sound: SOUNDS.some((s) => s.id === stored.sound) || isUserSoundId(stored.sound) ? stored.sound : "wood",
    accentStyle: SND.ACCENT_STYLES.some((a) => a.id === stored.accentStyle) ? stored.accentStyle : "pitch",
    countInSound: SND.COUNT_IN_SOUNDS.some((c) => c.id === stored.countInSound) ? stored.countInSound : "sticks",
    subVolume: Number.isFinite(stored.subVolume) ? stored.subVolume : 55,
    volume: Number.isFinite(stored.volume) ? stored.volume : 60,
    awake: ["off", "playing", "always"].includes(stored.awake) ? stored.awake : stored.wake === false ? "off" : "always",
    routeStop: stored.routeStop ?? true,
    // Play even when the iPad is on silent (owner requirement). On by default.
    playOnSilent: stored.playOnSilent ?? true,
    // Visual concept being compared (plan §04): a Studio, b Workshop, c Stage.
    // Owner's choice for now (2026-11-27): D · Console. A full redesign is planned.
    concept: CONCEPTS.some((c) => c.id === stored.concept) ? stored.concept : "d",
    settingsTab: ["click", "sound", "look", "ipad", "test"].includes(stored.settingsTab) ? stored.settingsTab : "click",
    workspace: stored.workspace === "practice" ? "practice" : "click",
    // Gap click (plan §07): off / cycle (play N bars, M silent) / random (seeded).
    gapMode: ["off", "cycle", "random"].includes(stored.gapMode) ? stored.gapMode : "off",
    gapPlay: Number.isInteger(stored.gapPlay) ? stored.gapPlay : 2,
    gapMute: Number.isInteger(stored.gapMute) ? stored.gapMute : 2,
    gapPercent: [10, 20, 30, 40, 50].includes(stored.gapPercent) ? stored.gapPercent : 30,
    gapSeed: Number.isInteger(stored.gapSeed) ? stored.gapSeed : Math.floor(1000 + Math.random() * 9000),
    gapHideLights: stored.gapHideLights ?? true,
    swing: SWING_CHOICES_IDS.includes(SWING_LEGACY[stored.swing] ?? stored.swing) ? (SWING_LEGACY[stored.swing] ?? stored.swing) : 50,
    // Layout: "dense" command centre (default, owner 2026-11-27) or "clean".
    layout: stored.layout === "clean" ? "clean" : "dense",
    tempoLock: stored.tempoLock === true,
    presetId: typeof stored.presetId === "string" ? stored.presetId : Array.isArray(stored.presets) ? null : "p-quick",
  };
  const answers = stored.answers || {};

  // Practice routines (plan §07). Two kinds:
  //   ladder:        start → top tempo in steps, one subdivision
  //   subdivisions:  one tempo, a list of subdivisions in turn
  // Each routine owns its meter, accents and gap click. `routineCfg` is the
  // working copy of the selected routine; Save as new / Update write it back.
  const STARTER_ROUTINES = [
    { id: "r-pedal", name: "Double-pedal control", note: "Plan's first routine. Eighths, short rests.", kind: "ladder", start: 130, step: 5, top: 160, play: 30, rest: 15, subdivision: 2, subs: [2], meterId: "4/4", accents: null, gaps: "off" },
    { id: "r-rudiments", name: "Rudiments with gap click", note: "Sixteenths; about a quarter of bars drop out.", kind: "ladder", start: 90, step: 10, top: 130, play: 45, rest: 15, subdivision: 4, subs: [4], meterId: "4/4", accents: null, gaps: "random25" },
    { id: "r-mallets", name: "Four-mallet subdivisions", note: "One tempo; eighths, triplets, sixteenths, sextuplets.", kind: "subdivisions", start: 72, step: 4, top: 72, play: 40, rest: 15, subdivision: 2, subs: [2, 3, 4, 6], meterId: "4/4", accents: null, gaps: "off" },
    { id: "r-independence", name: "Independence, quiet backbeat", note: "Click only on 2 and 4.", kind: "ladder", start: 80, step: 10, top: 110, play: 60, rest: 15, subdivision: 1, subs: [1], meterId: "4/4", accents: [0, 2, 0, 2], gaps: "off" },
    { id: "r-excerpt", name: "Excerpt tempo ladder", note: "Work up to performance tempo: set Top to your target.", kind: "ladder", start: 96, step: 6, top: 132, play: 45, rest: 20, subdivision: 1, subs: [1], meterId: "4/4", accents: null, gaps: "off" },
  ];
  const ROUTINE_GAPS = [
    { id: "off", label: "Off" }, { id: "random15", label: "Random 15%" }, { id: "random25", label: "Random 25%" },
    { id: "random40", label: "Random 40%" }, { id: "bars31", label: "Bars 3 + 1" }, { id: "bars22", label: "Bars 2 + 2" },
  ];
  const routines = Array.isArray(stored.routines) ? stored.routines : STARTER_ROUTINES.map((r) => ({ ...r }));
  if (!Array.isArray(stored.routines) && stored.routine && typeof stored.routine === "object") {
    // Earlier versions had one ladder; keep its values in the double-pedal routine.
    const old = stored.routine;
    Object.assign(routines[0], Object.fromEntries(["start", "step", "top", "play", "rest", "subdivision"].filter((k) => Number.isFinite(old[k])).map((k) => [k, old[k]])));
    routines[0].subs = [routines[0].subdivision];
  }
  let routineId = routines.some((r) => r.id === stored.routineId) ? stored.routineId : routines[0]?.id ?? null;
  const routineCfg = { ...(routines.find((r) => r.id === routineId) || STARTER_ROUTINES[0]), ...(stored.routineWorking && stored.routineWorking.id === routineId ? stored.routineWorking : {}) };
  // Saved sessions live on this device only (a repository comes later, plan §08).
  const sessions = Array.isArray(stored.sessions) ? stored.sessions.slice(0, 20) : [];

  // Presets: named Quick Click setups (plan §08 "Preset"). Starter examples are
  // added once and can be deleted.
  // Notes per preset ("song"), kept apart from the preset values so editing them
  // never marks a preset as edited.
  const presetNotes = stored.presetNotes && typeof stored.presetNotes === "object" ? stored.presetNotes : {};
  const PRESET_FIELDS = ["bpm", "meterId", "accents", "subdivision", "swing", "sound", "countInMode", "countInBars", "gapMode", "gapPlay", "gapMute", "gapPercent", "gapSeed", "grooveOn", "grooveId", "grooveLanes", "mix"];
  const presets = Array.isArray(stored.presets) ? stored.presets : [
    { id: "p-quick", name: "Quick Click", bpm: 120, meterId: "4/4", accents: null, subdivision: 1, sound: "wood", countInMode: "every", countInBars: 1 },
    { id: "p-pedal", name: "Double pedal eighths", bpm: 130, meterId: "4/4", accents: null, subdivision: 2, sound: "wood", countInMode: "every", countInBars: 1 },
    { id: "p-seven", name: "7/8 (2+2+3) groove", bpm: 220, meterId: "7/8a", accents: null, subdivision: 1, sound: "clave", countInMode: "every", countInBars: 1 },
  ];

  // ---------- engine state ----------
  const eng = {
    status: "idle",          // idle | countIn | playing | paused | interrupted
    ctx: null, master: null, buffers: null,
    plan: null, scheduledUntil: 0, sources: new Set(), visual: [],
    pending: null, queued: null, nowNote: null,
    hasStarted: false, barOffset: 0, elapsedBefore: 0, inGap: false,
    soundingPattern: null, catchingUp: false,
    worker: null, fallbackTimer: null, lastTick: 0,
    wakeLock: null, runStartPerf: 0, hiddenAt: null, missedAtHide: 0,
    bus: null, drums: null, grooveVisual: [], openHat: null,
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
    return T.makePattern({ meter, subdivision: settings.subdivision, accents: currentAccents(meter), swing: settings.swing });
  }
  // Swing (plan §07): only for paired subdivisions; the off-note moves later.
  const SWING_CHOICES = [
    { id: 50, label: "Straight", note: "50%" }, { id: 54, label: "Light", note: "54%" }, { id: 58, label: "Relaxed", note: "58%" },
    { id: 62, label: "Medium", note: "62%" }, { id: 67, label: "Triplet", note: "67%" }, { id: 70, label: "Heavy", note: "70%" },
    { id: 75, label: "Max", note: "75%" },
  ];
  const swingApplies = () => T.SWING_SUBDIVISIONS.includes(settings.subdivision) || settings.grooveOn === true;
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
  /**
   * A kit's voices as arrays of AudioBuffers (several takes per level for
   * recorded kits, played in rotation), built the first time the kit is used.
   * See Docs/DESIGN.md › Sounds.
   */
  const decodedSamples = {};
  function kitBuffers(id) {
    if (!eng.buffers[id]) {
      const ctx = eng.ctx;
      const meta = allSounds().find((k) => k.id === id) || SOUNDS.find((k) => k.id === "wood") || SOUNDS[0];
      const opts = { accentStyle: settings.accentStyle, countIn: settings.countInSound };
      let voices, sr;
      if (meta.recorded) {
        if (!decodedSamples[meta.id] && meta.levels) {
          decodedSamples[meta.id] = Object.fromEntries(Object.entries(meta.levels).map(([lv, takes]) => [lv, takes.map((b64) => SND.decodeWav(SND.fromBase64(b64)))]));
        }
        voices = SND.buildSampleKit(decodedSamples[meta.id], opts);
        sr = voices.sampleRate;
      } else {
        const v = SND.buildKit(meta.id, ctx.sampleRate, opts);
        voices = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, [x]]));
        sr = ctx.sampleRate;
      }
      const toBuffer = (data) => { const b = ctx.createBuffer(1, data.length, sr); b.getChannelData(0).set(data); return b; };
      eng.buffers[id] = {
        [L.downbeat]: voices.downbeat.map(toBuffer),
        [L.group]: voices.group.map(toBuffer),
        [L.normal]: voices.normal.map(toBuffer),
        [L.sub]: voices.sub.map(toBuffer),
        countIn: voices.countIn.map(toBuffer),
      };
    }
    return eng.buffers[id];
  }
  /** Next take for a level, rotating so repeated clicks aren't identical. */
  const takeCounters = {};
  function pickTake(kit, key) {
    const takes = kit[key];
    takeCounters[key] = ((takeCounters[key] || 0) + 1) % takes.length;
    return takes[takeCounters[key]];
  }
  function rebuildBuffers() {
    eng.buffers = {};
    if (eng.ctx) kitBuffers(settings.sound);
  }

  function ensureAudio() {
    if (eng.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("this browser has no Web Audio");
    eng.ctx = new Ctx({ latencyHint: "interactive" });
    eng.master = eng.ctx.createGain();
    eng.master.gain.value = volumeGain(settings.volume);
    eng.master.connect(eng.ctx.destination);
    // Subdivisions get their own volume, adjustable live.
    eng.subGain = eng.ctx.createGain();
    eng.subGain.gain.value = Math.pow(settings.subVolume / 100, 2);
    eng.bus = {};
    for (const ch of CHANNELS) eng.bus[ch.id] = makeBus();
    eng.subGain.connect(eng.bus.click.in);
    applyMix(true);
    eng.buffers = {};
    kitBuffers(settings.sound);
    eng.ctx.addEventListener("statechange", onAudioState);
    log(`Audio ready: ${eng.ctx.sampleRate} Hz, base latency ${ms(eng.ctx.baseLatency)}, output latency ${ms(eng.ctx.outputLatency)}`, "info");
  }
  // Voices are normalized with headroom (sounds.js), so the master curve adds gain back.
  const volumeGain = (pct) => Math.pow(pct / 100, 2) * 1.8;
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
      const practice = settings.workspace === "practice";
      if (practice && !isResume) beginRoutine();
      const pattern = practice ? routinePattern(rt.stages[rt.resumeStage].sub) : currentPattern();
      const tempo = practice ? routineTempo(rt.stages[rt.resumeStage].bpm) : currentTempo();
      const countIn = practice ? 1 : countInFor(isResume);
      if (practice) buildRoutinePlan(rt.resumeStage, eng.ctx.currentTime + START_DELAY);
      else eng.plan = T.PlaybackPlan.click({ pattern, tempo, countInBars: countIn, startTime: eng.ctx.currentTime + START_DELAY, gaps: currentGaps() });
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
    eng.openHat = null;
    if (typeof clearGrooveStep === "function" && eng.grooveVisual) clearGrooveStep();
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
    eng.inGap = false;
    $("gap-status").hidden = true;
    renderBeats();
  }

  function pause() {
    if (!isRunning()) return;
    if (rt.active && rt.current) rt.resumeStage = rt.current.stage;
    // Resume continues from the next bar number.
    if (eng.currentBar !== null && eng.currentBar >= 0) eng.barOffset += eng.currentBar + 1;
    silence();
    setStatus("paused");
    log(`Pause at bar ${eng.barOffset}`);
    renderTempoNote();
  }

  /**
   * The system interrupted playback (call, other app, output change, background).
   * Apple HIG › Playing audio: pause, keep the place, never resume on our own.
   */
  function systemPause(message, cause) {
    if (!isRunning()) return;
    pause();
    stats.interruptions++;
    showBanner(message);
    log(`Paused by the system (${cause}): ${message}`, "warn");
  }

  function stop(reason, cause = "") {
    if ((eng.status === "idle" || eng.status === "interrupted") && !reason) return;
    silence();
    stopSilentTrack();
    if (rt.active) endRoutine();
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
    if (document.getElementById("cc-play")) renderCommandKeys();
    const running = s === "playing" || s === "countIn";
    // Primary: Start / Stop / Resume. Secondary: Pause while running, Stop while paused.
    const primary = $("start");
    primary.dataset.running = String(running);
    primary.textContent = running ? "Stop" : s === "paused" ? "Resume" : settings.workspace === "practice" ? "Start routine" : "Start";
    const locked = running || s === "paused";
    for (const id of ["ws-click", "ws-practice", "rail-click", "rail-practice"]) $(id).disabled = locked && !$(id).matches("[aria-pressed='true'], [aria-current='page']");
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
    const sounds = kitBuffers(settings.sound);
    for (const e of eng.plan.eventsIn(from, to, { includeGaps: true })) {
      if (e.gap) {
        // Silent bar: nothing sounds; the beat lights still get the timing.
        e.pattern = eng.plan.segments[e.segment].pattern;
        eng.visual.push(e);
        continue;
      }
      const src = ctx.createBufferSource();
      src.buffer = pickTake(sounds, e.role === "countIn" ? "countIn" : e.level);
      src.connect(e.role !== "countIn" && e.level === L.sub ? eng.subGain : eng.bus.click.in);
      src.start(e.time);
      eng.sources.add(src);
      src.onended = () => eng.sources.delete(src);
      e.pattern = eng.plan.segments[e.segment].pattern;
      eng.visual.push(e);
      stats.scheduled++;
      stats.minHeadroom = Math.min(stats.minHeadroom, e.time - now);
    }
    if (grooveSounds()) scheduleGroove(from, to);
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
    const tempoUnit = settings.tempoChange === "now" ? "step" : settings.tempoChange;
    const apply = (unit) => {
      const pos = eng.plan.firstBoundaryAtOrAfter(eng.scheduledUntil, unit);
      if (!pos) return null;
      eng.plan = pattern
        ? eng.plan.changingAt(pos, (s) => ({ ...s, tempo: tempo || s.tempo, pattern: s.role === "music" ? pattern : s.pattern }))
        : eng.plan.changingTempoAt(tempo, pos);
      return { pos, unit };
    };
    let done = null;
    if (pattern) {
      // Accent-only changes keep the bar's grid, so they land on the next click;
      // a new meter or subdivision has to wait for the bar line.
      try { done = apply("step"); } catch { done = null; }
      if (!done) done = apply("bar");
    } else {
      done = apply(tempoUnit);
    }
    if (!done) return;
    eng.queued = { ...done.pos, label: eng.pending.label, unit: done.unit };
    eng.pending = null;
    log(`Change queued for bar ${done.pos.bar + 1}${done.pos.grid ? `, step ${done.pos.grid + 1}` : ""}: ${eng.queued.label}`);
    renderTempoNote();
  }

  /** kind: "tempo" or "pattern". A pattern change carries the tempo too (meter can change the beat unit). */
  function queueChange(kind) {
    if (!isRunning() || rt.active) return;
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
      systemPause(document.hidden
        ? "Click paused while POCKET was in the background. Press Resume to continue."
        : "Click paused. A call or another app took over the sound. Press Resume when you're ready.", `audio ${st}`);
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
        systemPause("Click paused while POCKET was in the background. Press Resume to continue.", "audio stopped in background");
      } else if (playing && missed > 0) {
        systemPause(`Click paused: POCKET skipped ${missed} click${missed === 1 ? "" : "s"} while in the background. Press Resume to continue.`, "clicks skipped in background");
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
        systemPause("Click paused because the sound output changed. Check where it will play, then press Resume.", "output changed");
      }
    });
  }

  // ---------- keep the screen awake ----------
  // Wake Lock API first; if it's missing or refused, a silent looping inline
  // video (the NoSleep technique) keeps iPadOS from dimming and auto-locking.
  // Either way it only works while this page is in front: a web page cannot
  // unlock the iPad or stop the side button from locking it.
  const awakeState = { method: "off", video: null, wantTap: false, busy: false, again: false, lockRefused: false };
  function wantAwake() {
    // Paused counts as playing: you're mid-practice.
    const running = isRunning() || eng.status === "paused";
    return !document.hidden && (settings.awake === "always" || (settings.awake === "playing" && running));
  }
  // On iPad every browser is WebKit, and Chrome there can report a wake lock
  // that doesn't actually hold the screen (owner, 2026-11-26). So on WebKit both
  // methods run together, and a watchdog restarts whichever one drops.
  const AWAKE_BOTH = BROWSER.engine === "WebKit";
  async function updateAwake() {
    if (awakeState.busy) { awakeState.again = true; return; }
    awakeState.busy = true;
    awakeState.again = false;
    try {
      if (!wantAwake()) { releaseAwake(); return; }
      if ("wakeLock" in navigator && !eng.wakeLock && !awakeState.lockRefused) {
        try {
          const lock = await navigator.wakeLock.request("screen");
          eng.wakeLock = lock;
          lock.addEventListener("release", () => {
            if (eng.wakeLock === lock) eng.wakeLock = null;
            log("Screen wake lock released");
            refreshAwakeMethod();
            if (wantAwake()) setTimeout(updateAwake, 250);
          });
          log("Wake Lock granted", "info");
        } catch (e) {
          awakeState.lockRefused = true;
          log(`Wake Lock refused (${e.message})`, "warn");
        }
      }
      const needVideo = AWAKE_BOTH || !eng.wakeLock;
      const videoOn = awakeState.video && !awakeState.video.paused;
      if (needVideo && !videoOn) await startAwakeVideo();
      if (!needVideo && videoOn) awakeState.video.pause();
    } finally {
      awakeState.busy = false;
      refreshAwakeMethod();
      if (awakeState.again) updateAwake();
    }
  }
  function refreshAwakeMethod() {
    const lock = !!eng.wakeLock;
    const video = !!(awakeState.video && !awakeState.video.paused);
    let m = "off";
    if (lock && video) m = "both";
    else if (lock) m = "wakeLock";
    else if (video) m = "video";
    else if (wantAwake()) m = awakeState.wantTap ? "needsTap" : (("wakeLock" in navigator) || window.POCKET_NOSLEEP_MEDIA) ? "needsTap" : "unavailable";
    setAwakeMethod(m);
  }
  // Watchdog: every 5 s, put back anything the system took away.
  setInterval(() => {
    if (!wantAwake() || awakeState.busy) return;
    const videoDown = (AWAKE_BOTH || !eng.wakeLock) && awakeState.video && awakeState.video.paused && !awakeState.wantTap;
    const lockDown = "wakeLock" in navigator && !eng.wakeLock && !awakeState.lockRefused;
    if (videoDown || lockDown) {
      if (videoDown) log("Keep-awake video had stopped; restarting it", "warn");
      updateAwake();
    }
  }, 5000);
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
      // If iPadOS pauses it, try again straight away (a tap may be needed).
      v.addEventListener("pause", () => { if (wantAwake() && !awakeState.busy) setTimeout(updateAwake, 300); });
      document.body.append(v);
      awakeState.video = v;
    }
    try {
      await awakeState.video.play();
      awakeState.wantTap = false;
      log("Keep-awake video playing", "info");
    } catch (e) {
      // Needs a tap first; the next tap anywhere retries.
      awakeState.wantTap = true;
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
      both: "Screen is staying awake (Wake Lock + silent video).",
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
  document.addEventListener("pointerdown", () => {
    if (!wantAwake()) return;
    const wantVideo = AWAKE_BOTH || !eng.wakeLock;
    const videoOn = awakeState.video && !awakeState.video.paused;
    if (awakeState.wantTap || (wantVideo && !videoOn) || (!eng.wakeLock && awakeState.lockRefused)) {
      awakeState.lockRefused = false;
      awakeState.wantTap = false;
      updateAwake();
    }
  }, true);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) awakeState.lockRefused = false; });

  // ---------- visual loop ----------
  function frame() {
    const running = eng.status === "playing" || eng.status === "countIn";
    if (running && eng.ctx) {
      const t = eng.ctx.currentTime - (eng.ctx.outputLatency || 0);
      if (rt.active) updatePractice(t);
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
      if (latest) {
        const inGap = !!latest.gap;
        if (inGap !== eng.inGap) {
          eng.inGap = inGap;
          $("gap-status").hidden = !inGap;
        }
      }
      if (latest && latest.sub === 0) {
        eng.currentUnit = latest.gap && settings.gapHideLights ? -1 : latest.unit;
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
      if (settings.layout === "dense") {
        const barText = eng.currentBar === null ? "–" : eng.currentBar < 0 ? `C${eng.currentBar + eng.countInBars + 1}` : String(eng.currentBar + eng.barOffset + 1);
        if ($("cc-bar").textContent !== barText) $("cc-bar").textContent = barText;
        const beatText = eng.currentUnit >= 0 ? String(eng.currentUnit + 1) : "–";
        if ($("cc-beat").textContent !== beatText) $("cc-beat").textContent = beatText;
        const t = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}`;
        if ($("cc-length").textContent !== t) $("cc-length").textContent = t;
      }
      let step = null;
      while (eng.grooveVisual.length && eng.grooveVisual[0].time <= t) step = eng.grooveVisual.shift();
      if (step) showGrooveStep(step.step);
      if (rt.active && rt.current) $("pos-bar").textContent = `Stage ${rt.current.stage + 1}/${rt.stages.length}`;
      else $("pos-bar").textContent = eng.currentBar === null ? (eng.barOffset ? `Bar ${eng.barOffset + 1}` : "Bar –") : eng.currentBar < 0 ? `Count-in ${eng.currentBar + eng.countInBars + 1}` : `Bar ${eng.currentBar + eng.barOffset + 1}`;
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
    const when = (unit) => ({ bar: "Next bar: ", beat: "Next beat: ", step: "Now ", now: "Now " })[unit] || "";
    const pendingUnit = (p) => (p.pattern ? (T.sameGrid(p.pattern, eng.soundingPattern) ? "step" : "bar") : settings.tempoChange);
    if (eng.pending) note.textContent = `${when(pendingUnit(eng.pending))}${eng.pending.label}`;
    else if (eng.queued) note.textContent = `${when(eng.queued.unit)}${eng.queued.label}`;
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
    // Accent edits show at once; a new meter or subdivision previews until its bar line.
    const waitsForBar = running && eng.soundingPattern && !T.sameGrid(eng.soundingPattern, target);
    const shown = waitsForBar ? eng.soundingPattern : target;
    const preview = waitsForBar ? target : null;
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

  /** Render a row of toggle chips into one or more containers (main screen and Settings). */
  function chip(containers, items, isOn, onPick) {
    for (const id of [].concat(containers)) renderChips($(id), items, isOn, onPick);
  }
  function renderChips(el, items, isOn, onPick) {
    el.textContent = "";
    for (const item of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", String(isOn(item)));
      b.innerHTML = "";
      b.append(document.createTextNode(item.label));
      if (item.note) { const s = document.createElement("small"); s.textContent = item.note; b.append(s); }
      // Spoken name keeps label and note apart ("7/8, 2+2+3"), or uses a fuller name.
      if (item.spoken || item.note) b.setAttribute("aria-label", item.spoken || `${item.label}, ${item.note}`);
      b.addEventListener("click", () => { onPick(item); renderSetup(); saveStore(); });
      el.append(b);
    }
  }
  function renderSetup() {
    chip(["meter-chips", "meter-chips-sheet"], METERS.map((m) => ({ ...m, label: m.label || m.id })), (m) => m.id === settings.meterId, (m) => {
      if (m.id === settings.meterId) return;
      settings.meterId = m.id;
      settings.accents = null;
      renderTempo(); queueChange("pattern"); renderBeats();
    });
    const subNames = { 1: "off", 2: "÷2", 3: "÷3", 4: "÷4", 5: "÷5", 6: "÷6", 7: "÷7" };
    chip(["sub-chips", "sub-chips-sheet"], SUBDIVISIONS.map((n) => ({ id: n, label: n === 1 ? "Off" : subNames[n], spoken: n === 1 ? "No subdivision" : `Subdivide by ${n}` })), (s) => s.id === settings.subdivision, (s) => {
      settings.subdivision = s.id; queueChange("pattern"); renderBeats();
    });
    const pickSwing = (x) => {
      if (x.id === settings.swing) return;
      settings.swing = x.id;
      log(`Swing: ${x.id === 50 ? "straight" : `${x.id}%`}`);
      queueChange("pattern");
    };
    chip(["swing-chips", "swing-chips-sheet"], SWING_CHOICES, (x) => x.id === settings.swing, pickSwing);
    const applies = swingApplies();
    $("swing-field").hidden = !applies;
    $("swing-note-sheet").textContent = applies
      ? "Moves the second note of each pair later; beats stay exact. 67% is triplet swing."
      : "Swing works with ÷2 (eighths) and ÷4 (sixteenths), or with a groove playing. Pick one under Subdivision.";
    for (const b of $("swing-chips-sheet").querySelectorAll("button")) b.disabled = !applies;
    chip("countin-chips", COUNT_IN_MODES, (c) => c.id === settings.countInMode, (c) => { settings.countInMode = c.id; });
    chip("countin-bars-chips", COUNT_IN_BARS.map((n) => ({ id: n, label: `${n} bar${n > 1 ? "s" : ""}` })), (c) => c.id === settings.countInBars, (c) => { settings.countInBars = c.id; });
    $("countin-bars").hidden = settings.countInMode === "off";
    chip("tempo-change-chips", TEMPO_CHANGE, (t) => t.id === settings.tempoChange, (t) => { settings.tempoChange = t.id; log(`Tempo changes land on: ${t.label}`); });
    renderLcd();
    renderPracticeChips();
    chip("layout-chips", [{ id: "dense", label: "Dense", note: "command centre" }, { id: "clean", label: "Clean" }], (l) => l.id === settings.layout, (l) => {
      if (l.id === settings.layout) return;
      settings.layout = l.id;
      applyLayout();
      log(`Layout: ${l.label}`);
    });
    if (document.getElementById("cc-play")) renderCommandKeys();
    renderGroove();
    chip("concept-chips", CONCEPTS, (c) => c.id === settings.concept, (c) => {
      if (c.id === settings.concept) return;
      settings.concept = c.id;
      applyConcept();
      log(`Design concept: ${c.label} (${c.name})`);
    });
    const pickSound = (s) => {
      settings.sound = s.id;
      log(`Sound: ${s.label}${s.recorded ? " (recorded)" : ""}`);
      if (!isRunning()) previewSound();
    };
    chip("sound-chips", SAMPLE_KITS, (s) => s.id === settings.sound, pickSound);
    chip("synth-chips", SYNTH_KITS, (s) => s.id === settings.sound, pickSound);
    chip("user-sound-chips", userKits, (s) => s.id === settings.sound, pickSound);
    renderUserSoundActions();
    chip("accent-style-chips", SND.ACCENT_STYLES, (a) => a.id === settings.accentStyle, (a) => {
      if (a.id === settings.accentStyle) return;
      settings.accentStyle = a.id;
      rebuildBuffers();
      if (!isRunning()) previewSound();
    });
    chip("countin-sound-chips", SND.COUNT_IN_SOUNDS, (c) => c.id === settings.countInSound, (c) => {
      if (c.id === settings.countInSound) return;
      settings.countInSound = c.id;
      rebuildBuffers();
      if (!isRunning()) previewSound();
    });
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
      "Keeping screen awake": { both: "yes (Wake Lock + video)", wakeLock: "yes (Wake Lock)", video: "yes (silent video)", needsTap: "needs a tap", unavailable: "not possible", off: "no" }[awakeState.method],
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
    lines.push(`  Settings: ${fmtBpm(settings.bpm)} BPM, ${currentMeter().label}, subdivision ${settings.subdivision}${swingApplies() && settings.swing > 50 ? ` swing ${settings.swing}%` : ""}, count-in ${settings.countInMode} (${settings.countInBars} bar), tempo changes on next ${settings.tempoChange}, sound ${settings.sound} (accents: ${settings.accentStyle}, count-in: ${settings.countInSound}, subdivisions ${settings.subVolume}%), volume ${settings.volume}%, gap click ${settings.gapMode === "off" ? "off" : gapSummary()}${settings.gapMode !== "off" ? ` (lights ${settings.gapHideLights ? "hidden" : "shown"})` : ""}, keep screen awake ${settings.awake}, stop on output change ${settings.routeStop}, play in silent mode ${settings.playOnSilent}`);
    lines.push("", "Checklist");
    for (const c of CHECKS) for (const r of c.rows) lines.push(`  ${r.label}: ${answers[r.id] || "Not tried"}`);
    lines.push("", "Practice sessions (latest first)");
    if (!sessions.length) lines.push("  (none saved)");
    for (const x of sessions.slice(0, 5)) {
      lines.push(`  ${x.date.slice(0, 16).replace("T", " ")}: ${x.start}→${x.top} by ${x.step}, ${x.play}s/${x.rest}s, clean ${x.cleanTempo ?? "–"} BPM, ${x.stages.filter((r) => r.completed).length}/${x.stages.length} stages done${x.notes ? `, notes: ${x.notes}` : ""}`);
    }
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
  // Hardware keyboard tempo (HIG › Steppers: a modifier for bigger steps): ↑/↓ ±1, Shift ±5.
  document.addEventListener("keydown", (e) => {
    if (keypad.open || e.target.closest("input, textarea, select, [role=slider]")) return;
    if (!$("settings").hidden) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      if (!tempoLocked()) setBpm(Math.round(settings.bpm) + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 5 : 1));
    }
  });
  // Nudges. ±1 repeats while held: after 400 ms, 8 steps a second, no
  // acceleration; stops when the finger lifts or slides off (Docs/UX.md J3).
  const HOLD_DELAY = 400;
  const HOLD_RATE = 125;
  /** Tempo lock (Command Center switch): stops accidental tempo changes. */
  function tempoLocked() {
    if (!settings.tempoLock) return false;
    showToast("Tempo is locked. Turn off Tempo lock to change it.");
    return true;
  }
  const nudge = (b) => { if (!tempoLocked()) setBpm(Math.round(settings.bpm) + Number(b.dataset.nudge)); };
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
    if (tempoLocked()) return;
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

  // ---------- number pad ----------
  // iPadOS shows its full keyboard even for number fields, so POCKET draws its
  // own pad (HIG › Pickers: shown in context, next to the value being edited).
  // Used for the tempo and the Practice setup values. The first key replaces
  // the shown value. Hardware keys work too (digits, ".", Backspace, Enter, Escape).
  const keypad = { open: false, text: "", fresh: true, lastFocus: null, cfg: null };
  function placeKeypad() {
    const el = $("keypad");
    const anchor = keypad.cfg.anchor.getBoundingClientRect();
    const transportTop = document.querySelector(".transport").getBoundingClientRect().top;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.min(Math.max(16, anchor.left), window.innerWidth - w - 16);
    let top = anchor.bottom + 8;
    if (top + h > transportTop - 8) top = Math.max(16, transportTop - 8 - h);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }
  const fmtNum = (v, decimals) => (decimals ? fmtBpm(v) : String(Math.round(v)));
  function renderKeypad(error) {
    const cfg = keypad.cfg;
    const v = $("keypad-value");
    v.textContent = keypad.fresh ? fmtNum(cfg.value, cfg.decimals) : (keypad.text || "–");
    v.classList.toggle("fresh", keypad.fresh);
    const note = $("keypad-note");
    note.textContent = error || `${cfg.min} to ${cfg.max}${cfg.unit ? ` ${cfg.unit}` : ""}`;
    note.classList.toggle("error", !!error);
  }
  /** cfg: { title, value, min, max, decimals (0 or 2), unit, anchor, onSet(value) } */
  function openKeypad(cfg) {
    if (keypad.open) closeKeypad();
    keypad.cfg = cfg;
    keypad.open = true;
    keypad.text = "";
    keypad.fresh = true;
    keypad.lastFocus = document.activeElement;
    $("keypad-title").textContent = cfg.title;
    $("keypad").querySelector('[data-key="."]').disabled = !cfg.decimals;
    $("keypad").hidden = false;
    renderKeypad();
    placeKeypad();
    $("keypad").querySelector('[data-key="1"]').focus({ preventScroll: true });
  }
  function closeKeypad() {
    if (!keypad.open) return;
    keypad.open = false;
    $("keypad").hidden = true;
    if (keypad.lastFocus && document.contains(keypad.lastFocus)) keypad.lastFocus.focus({ preventScroll: true });
  }
  function pressKey(k) {
    const cfg = keypad.cfg;
    let t = keypad.fresh ? "" : keypad.text;
    if (k === "back") t = t.slice(0, -1);
    else if (k === ".") { if (cfg.decimals && !t.includes(".")) t = (t || "0") + "."; }
    else if (t.includes(".")) { if (t.split(".")[1].length < cfg.decimals) t += k; }
    else if (t.length < 3) t += k; // every POCKET value fits in three whole digits
    keypad.text = t;
    keypad.fresh = false;
    renderKeypad();
  }
  function commitKeypad() {
    const cfg = keypad.cfg;
    if (keypad.fresh) { closeKeypad(); return; }
    const v = Number(keypad.text);
    if (!keypad.text || !Number.isFinite(v) || v < cfg.min || v > cfg.max) {
      renderKeypad(`Enter a value from ${cfg.min} to ${cfg.max}.`);
      return;
    }
    closeKeypad();
    cfg.onSet(v);
  }
  $("bpm-display").addEventListener("click", () => {
    if (tempoLocked()) return;
    if (keypad.open && keypad.cfg.anchor === $("bpm-display")) { closeKeypad(); return; }
    openKeypad({ title: "Set tempo", value: settings.bpm, min: T.TEMPO_MIN, max: T.TEMPO_MAX, decimals: 2, unit: "BPM", anchor: $("bpm-display"), onSet: setBpm });
  });
  $("keypad").addEventListener("click", (e) => { const b = e.target.closest("[data-key]"); if (b && !b.disabled) pressKey(b.dataset.key); });
  $("keypad-set").addEventListener("click", commitKeypad);
  $("keypad-cancel").addEventListener("click", closeKeypad);
  document.addEventListener("pointerdown", (e) => {
    if (keypad.open && !e.target.closest("#keypad, .transport") && !keypad.cfg.anchor.contains(e.target)) closeKeypad();
  }, true);
  document.addEventListener("keydown", (e) => {
    if (!keypad.open) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); pressKey(e.key); }
    else if (e.key === "." || e.key === ",") { e.preventDefault(); pressKey("."); }
    else if (e.key === "Backspace") { e.preventDefault(); pressKey("back"); }
    else if (e.key === "Enter") { e.preventDefault(); commitKeypad(); }
    else if (e.key === "Escape") { e.preventDefault(); closeKeypad(); }
  });
  window.addEventListener("resize", () => { if (keypad.open) placeKeypad(); });

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

  // ---------- practice: interval ladder (M2) ----------
  // The whole ladder is one immutable plan: count-in, play stage 1, then for each
  // later stage a silent rest that ends in a 1-bar count-in at the next tempo, then
  // play. Stages are rounded to whole bars so every stage starts on a downbeat.
  // Repeat / Step down rebuild the plan from the next rest; earlier clicks never move.
  const rt = { active: false, stages: [], meta: [], playIdx: [], log: [], current: null, resumeStage: 0, summaryOpen: false, startedAt: null, rateStage: null, discardArmed: false };

  function clampCfg() {
    const n = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    routineCfg.start = n(Math.round(routineCfg.start), T.TEMPO_MIN, T.TEMPO_MAX, 130);
    routineCfg.step = n(Math.round(routineCfg.step), 1, 20, 5);
    routineCfg.top = n(Math.round(routineCfg.top), routineCfg.start, T.TEMPO_MAX, Math.max(routineCfg.start, 160));
    routineCfg.play = n(Math.round(routineCfg.play), 5, 600, 30);
    routineCfg.rest = n(Math.round(routineCfg.rest), 0, 300, 15);
    routineCfg.subdivision = [1, 2, 3, 4, 5, 6, 7].includes(routineCfg.subdivision) ? routineCfg.subdivision : 2;
    routineCfg.kind = routineCfg.kind === "subdivisions" ? "subdivisions" : "ladder";
    if (!Array.isArray(routineCfg.subs) || !routineCfg.subs.length) routineCfg.subs = [routineCfg.subdivision];
    routineCfg.subs = [...new Set(routineCfg.subs.filter((n) => n >= 1 && n <= 7))].sort((a, b) => a - b);
    if (!METERS.some((m) => m.id === routineCfg.meterId)) routineCfg.meterId = "4/4";
    if (!ROUTINE_GAPS.some((g) => g.id === routineCfg.gaps)) routineCfg.gaps = "off";
  }
  /** Stages as { bpm, sub } for the working routine. */
  function stagesFor(cfg = routineCfg) {
    if (cfg.kind === "subdivisions") return cfg.subs.map((sub) => ({ bpm: cfg.start, sub }));
    return ladder(cfg.start).map((bpm) => ({ bpm, sub: cfg.subdivision }));
  }
  const stageLabel = (st) => `${fmtBpm(st.bpm)} BPM${routineCfg.kind === "subdivisions" || st.sub > 1 ? ` ÷${st.sub}` : ""}`;
  function routineMeter() {
    const d = METERS.find((m) => m.id === routineCfg.meterId) || METERS[0];
    return T.makeMeter(d.num, d.den, d.grouping);
  }
  function routineGaps() {
    const g = routineCfg.gaps;
    if (g === "bars31") return { mode: "cycle", play: 3, mute: 1 };
    if (g === "bars22") return { mode: "cycle", play: 2, mute: 2 };
    if (typeof g === "string" && g.startsWith("random")) return { mode: "random", percent: Number(g.slice(6)), seed: settings.gapSeed };
    return { mode: "off" };
  }
  function ladder(from) {
    const out = [];
    for (let t = from; t <= routineCfg.top + 1e-9 && out.length < 60; t += routineCfg.step) out.push(t);
    return out.length ? out : [from];
  }
  function routinePattern(sub = routineCfg.subdivision) {
    const meter = routineMeter();
    const accents = Array.isArray(routineCfg.accents) && routineCfg.accents.length === meter.num ? routineCfg.accents : T.defaultAccents(meter);
    return T.makePattern({ meter, subdivision: sub, accents });
  }
  const routineTempo = (bpm) => T.makeTempo(bpm, routineMeter().defaultBeatUnit);
  function stageBars(seconds, tempo, pattern) {
    const barSec = tempo.secondsPerWhole * pattern.meter.num / pattern.meter.den;
    return { bars: Math.max(1, Math.round(seconds / barSec)), barSec };
  }
  function segmentsForStage(stages, i, withRest) {
    const pattern = routinePattern(stages[i].sub);
    const meter = pattern.meter;
    const tempo = routineTempo(stages[i].bpm);
    const countIn = T.makePattern({ meter, subdivision: 1, accents: pattern.accents.map((l) => (l === T.LEVEL.muted ? T.LEVEL.normal : l)) });
    const items = [];
    if (withRest) {
      const { bars } = stageBars(routineCfg.rest, tempo, pattern);
      if (bars > 1) {
        const silent = T.makePattern({ meter, accents: Array(meter.num).fill(T.LEVEL.muted), subLevel: T.LEVEL.muted });
        items.push({ seg: T.makeSegment({ pattern: silent, tempo, bars: bars - 1 }), meta: { stage: i, phase: "rest" } });
      }
    }
    items.push({ seg: T.makeSegment({ pattern: countIn, tempo, bars: 1, role: "countIn" }), meta: { stage: i, phase: "countIn" } });
    items.push({ seg: T.makeSegment({ pattern, tempo, bars: stageBars(routineCfg.play, tempo, pattern).bars }), meta: { stage: i, phase: "play" } });
    return items;
  }
  function indexPlays() {
    rt.playIdx = [];
    rt.meta.forEach((m, i) => { if (m.phase === "play") rt.playIdx[m.stage] = i; });
  }
  function buildRoutinePlan(from, startTime) {
    const items = segmentsForStage(rt.stages, from, false);
    for (let i = from + 1; i < rt.stages.length; i++) items.push(...segmentsForStage(rt.stages, i, true));
    eng.plan = new T.PlaybackPlan(items.map((x) => x.seg), startTime, { gaps: routineGaps() });
    rt.meta = items.map((x) => x.meta);
    rt.current = null;
    indexPlays();
  }
  function beginRoutine() {
    clampCfg();
    rt.stages = stagesFor();
    rt.log = rt.stages.map((st) => ({ tempo: st.bpm, sub: st.sub, label: stageLabel(st), started: false, completed: false, effort: null, clean: false }));
    rt.resumeStage = 0;
    rt.active = true;
    rt.summaryOpen = false;
    rt.rateStage = null;
    rt.finished = false;
    rt.startedAt = new Date().toISOString();
    log(`Routine "${routineCfg.name}": ${rt.stages.map(stageLabel).join(" → ")}, ${routineCfg.play} s play, ${routineCfg.rest} s rest`);
    renderPractice();
  }

  function updatePractice(t) {
    const plan = eng.plan;
    let idx = 0;
    for (let i = 0; i < plan.segmentCount; i++) {
      const span = plan.segmentSpan(i);
      if (t >= span.start) idx = i;
    }
    const end = plan.endTime;
    if (end !== null && t >= end) {
      if (rt.current && rt.current.phase === "play") rt.log[rt.current.stage].completed = true;
      rt.finished = true;
      log("Routine complete", "info");
      stop();
      return;
    }
    const meta = rt.meta[idx];
    if (!rt.current || rt.current.idx !== idx) {
      const prev = rt.current;
      if (prev && prev.phase === "play" && prev.stage !== meta.stage) {
        rt.log[prev.stage].completed = true;
        rt.rateStage = prev.stage;
      }
      if (meta.phase === "play") rt.log[meta.stage].started = true;
      rt.current = { ...meta, idx };
      renderPracticeLive();
    }
    const playSpan = plan.segmentSpan(rt.playIdx[meta.stage]);
    const left = meta.phase === "play" ? playSpan.end - t : playSpan.start - t;
    const secs = Math.max(0, Math.ceil(left));
    const text = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    if ($("rt-time").textContent !== text) $("rt-time").textContent = text;
  }

  function renderPracticeLive() {
    const cur = rt.current;
    if (!cur) return;
    const stage = cur.stage;
    $("rt-phase").dataset.phase = cur.phase;
    $("rt-phase").textContent = { play: "Play", rest: "Rest", countIn: "Count-in" }[cur.phase];
    const st = rt.stages[stage];
    $("rt-tempo").textContent = fmtBpm(st.bpm);
    $("rt-sub").textContent = routineCfg.kind === "subdivisions" || st.sub > 1 ? `÷${st.sub} · ${subdivisionName(routinePattern(st.sub))}` : "";
    const next = rt.stages[stage + 1];
    $("rt-stage").textContent = `${routineCfg.name} · Stage ${stage + 1} of ${rt.stages.length}${cur.phase === "play" ? (next !== undefined ? ` · Next: ${stageLabel(next)}` : " · Last stage") : ` · Coming up: ${stageLabel(st)}`}`;
    const canChange = cur.phase === "play";
    $("rt-repeat").disabled = !canChange;
    $("rt-down").disabled = !canChange;
    renderRating();
  }
  function renderRating() {
    const show = rt.rateStage !== null && rt.current && rt.current.phase !== "play";
    $("rt-rate").hidden = !show;
    if (!show) return;
    const entry = rt.log[rt.rateStage];
    $("rt-rate-q").textContent = `How did ${entry.label} feel?`;
    $("rt-clean").checked = entry.clean;
    renderPracticeChips();
  }
  function renderPracticeChips() {
    const changed = () => { clampCfg(); renderPreview(); renderRoutines(); };
    chip("rt-sub-chips", [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: n, label: n === 1 ? "Off" : `÷${n}` })), (x) => x.id === routineCfg.subdivision, (x) => { routineCfg.subdivision = x.id; routineCfg.subs = [x.id]; changed(); });
    // Subdivision routines: tap to add or remove; played in order from slow to fast.
    chip("rt-subs-chips", [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: n, label: `÷${n}` })), (x) => routineCfg.subs.includes(x.id), (x) => {
      const has = routineCfg.subs.includes(x.id);
      if (has && routineCfg.subs.length === 1) return;
      routineCfg.subs = has ? routineCfg.subs.filter((n) => n !== x.id) : routineCfg.subs.concat([x.id]);
      changed();
    });
    chip("rt-meter-chips", METERS.map((m) => ({ ...m, label: m.label || m.id })), (m) => m.id === routineCfg.meterId, (m) => {
      if (m.id === routineCfg.meterId) return;
      routineCfg.meterId = m.id;
      routineCfg.accents = null; // a different meter starts from its default accents
      changed();
    });
    chip("rt-gap-chips", ROUTINE_GAPS, (g) => g.id === routineCfg.gaps, (g) => { routineCfg.gaps = g.id; changed(); });
    if (rt.rateStage !== null && rt.log[rt.rateStage]) {
      const entry = rt.log[rt.rateStage];
      chip("rt-effort", [1, 2, 3, 4, 5].map((n) => ({ id: n, label: String(n), note: n === 1 ? "easy" : n === 5 ? "hard" : "" })), (x) => x.id === entry.effort, (x) => { entry.effort = x.id; log(`Effort ${x.id} for ${entry.label}`); });
    }
  }

  /** Repeat the current stage, or step down, from the next rest on. */
  function changeLadder(kind) {
    const cur = rt.current;
    if (!rt.active || !cur || cur.phase !== "play") return;
    const plan = eng.plan;
    const nextIdx = rt.meta.findIndex((m) => m.stage === cur.stage + 1);
    const boundary = nextIdx >= 0 ? plan.segmentSpan(nextIdx).start : plan.endTime;
    if (boundary <= eng.scheduledUntil + 0.01) { $("rt-note").textContent = "Too late for this stage. Try again during the next one."; return; }
    const keep = rt.stages.slice(0, cur.stage + 1);
    const here = rt.stages[cur.stage];
    const lower = Math.max(T.TEMPO_MIN, here.bpm - routineCfg.step);
    let stages;
    if (kind === "repeat") stages = keep.concat([{ ...here }], rt.stages.slice(cur.stage + 1));
    else if (routineCfg.kind === "subdivisions") {
      // One step slower, then the remaining subdivisions at that tempo.
      stages = keep.concat([{ bpm: lower, sub: here.sub }], rt.stages.slice(cur.stage + 1).map((st) => ({ bpm: lower, sub: st.sub })));
    } else stages = keep.concat(ladder(lower).map((bpm) => ({ bpm, sub: here.sub })));
    const cut = nextIdx >= 0 ? nextIdx : plan.segmentCount;
    const tail = [];
    for (let i = cur.stage + 1; i < stages.length; i++) tail.push(...segmentsForStage(stages, i, true));
    eng.plan = new T.PlaybackPlan(plan.segments.slice(0, cut).concat(tail.map((x) => x.seg)), plan.startTime, { gaps: plan.gaps });
    rt.meta = rt.meta.slice(0, cut).concat(tail.map((x) => x.meta));
    rt.stages = stages;
    rt.log = rt.log.slice(0, cur.stage + 1).concat(stages.slice(cur.stage + 1).map((st) => ({ tempo: st.bpm, sub: st.sub, label: stageLabel(st), started: false, completed: false, effort: null, clean: false })));
    indexPlays();
    const msg = kind === "repeat" ? `Repeating ${stageLabel(here)} next` : routineCfg.kind === "subdivisions" ? `Next: ${stageLabel(stages[cur.stage + 1])}, the rest at that tempo` : `Next stage: ${stageLabel(stages[cur.stage + 1])}, then up again`;
    $("rt-note").textContent = msg;
    log(`Routine changed (${kind === "repeat" ? "repeat" : "step down"}): ${stages.slice(cur.stage + 1).map(stageLabel).join(" → ")}`);
    renderPracticeLive();
  }

  function endRoutine() {
    rt.active = false;
    rt.summaryOpen = rt.log.some((x) => x.started);
    rt.current = null;
    rt.discardArmed = false;
    $("rt-note").textContent = "";
    renderPractice();
    if (rt.summaryOpen) renderSummary();
  }
  function renderSummary() {
    const rows = $("rt-rows");
    rows.textContent = "";
    rt.log.forEach((entry, i) => {
      if (!entry.started) return;
      const tr = document.createElement("tr");
      const td = (content) => { const c = document.createElement("td"); if (content instanceof Node) c.append(content); else c.textContent = content; tr.append(c); };
      td(String(i + 1));
      td(entry.label || `${fmtBpm(entry.tempo)} BPM`);
      td(entry.completed ? "Yes" : "Stopped");
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", `Effort for stage ${i + 1}`);
      for (const v of ["–", "1", "2", "3", "4", "5"]) { const o = document.createElement("option"); o.textContent = v; sel.append(o); }
      sel.value = entry.effort ? String(entry.effort) : "–";
      sel.addEventListener("change", () => { entry.effort = sel.value === "–" ? null : Number(sel.value); });
      td(sel);
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = entry.clean;
      cb.setAttribute("aria-label", `Stage ${i + 1} was clean`);
      cb.addEventListener("change", () => { entry.clean = cb.checked; fillCleanTempo(); });
      td(cb);
      rows.append(tr);
    });
    const done = rt.log.filter((x) => x.completed).length;
    $("rt-sum-title").textContent = `${routineCfg.name}: ${rt.finished ? `complete · ${done} stages` : `stopped · ${done} stage${done === 1 ? "" : "s"} completed`}`;
    $("rt-notes").value = "";
    fillCleanTempo();
  }
  function fillCleanTempo() {
    const sel = $("rt-clean-tempo");
    const tempos = [...new Set(rt.log.filter((x) => x.started).map((x) => x.tempo))].sort((a, b) => b - a);
    const clean = rt.log.filter((x) => x.clean).map((x) => x.tempo);
    const done = rt.log.filter((x) => x.completed).map((x) => x.tempo);
    const best = clean.length ? Math.max(...clean) : done.length ? Math.max(...done) : tempos[tempos.length - 1];
    sel.textContent = "";
    for (const t of tempos) { const o = document.createElement("option"); o.value = String(t); o.textContent = `${fmtBpm(t)} BPM`; sel.append(o); }
    if (best !== undefined) sel.value = String(best);
  }
  function renderPractice() {
    $("practice-setup").hidden = rt.active || rt.summaryOpen;
    $("practice-live").hidden = !rt.active;
    $("practice-summary").hidden = !rt.summaryOpen;
    if (!rt.active && !rt.summaryOpen) {
      renderRoutines();
      renderRtFields();
      renderPracticeChips();
      renderPreview();
    }
    renderHistory();
  }
  function renderPreview() {
    clampCfg();
    const stages = stagesFor();
    let total = 0;
    stages.forEach((st, i) => {
      const pattern = routinePattern(st.sub);
      const tempo = routineTempo(st.bpm);
      const play = stageBars(routineCfg.play, tempo, pattern);
      total += play.bars * play.barSec;
      const rest = stageBars(routineCfg.rest, tempo, pattern);
      total += i === 0 ? play.barSec : rest.bars * rest.barSec;
    });
    const m = Math.floor(total / 60), sec = Math.round(total % 60);
    const gap = ROUTINE_GAPS.find((g) => g.id === routineCfg.gaps);
    $("rt-preview").textContent = `${stages.length} stage${stages.length === 1 ? "" : "s"}: ${stages.map(stageLabel).join(" → ")} · about ${m} min ${String(sec).padStart(2, "0")} s${routineCfg.gaps !== "off" ? ` · gap click ${gap.label.toLowerCase()}` : ""}`;
  }
  function renderHistory() {
    const list = $("rt-history");
    list.textContent = "";
    if (!sessions.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Sessions you save appear here.";
      list.append(li);
      return;
    }
    for (const x of sessions.slice(0, 10)) {
      const li = document.createElement("li");
      const when = new Date(x.date);
      const head = document.createElement("div");
      head.textContent = `${when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · clean ${x.cleanTempo ?? "–"} BPM`;
      const meta = document.createElement("div");
      meta.className = "meta";
      const efforts = x.stages.map((r) => r.effort).filter(Boolean);
      const avg = efforts.length ? (efforts.reduce((a, b) => a + b, 0) / efforts.length).toFixed(1) : null;
      const range = x.kind === "subdivisions" ? `${x.start} BPM ÷${(x.subs || []).join(" ÷")}` : `${x.start}→${x.top} by ${x.step}`;
      meta.textContent = `${x.routine ? `${x.routine} · ` : ""}${range} · ${x.stages.filter((r) => r.completed).length}/${x.stages.length} stages${avg ? ` · effort ${avg}` : ""}${x.notes ? ` · ${x.notes}` : ""}`;
      li.append(head, meta);
      list.append(li);
    }
  }

  const RT_FIELDS = {
    start: { title: "Start tempo", min: T.TEMPO_MIN, max: T.TEMPO_MAX, unit: "BPM" },
    step: { title: "Step up by", min: 1, max: 20, unit: "BPM" },
    top: { title: "Top tempo", min: T.TEMPO_MIN, max: T.TEMPO_MAX, unit: "BPM" },
    play: { title: "Play", min: 5, max: 600, unit: "seconds" },
    rest: { title: "Rest", min: 0, max: 300, unit: "seconds" },
  };
  function renderRtFields() {
    const subsKind = routineCfg.kind === "subdivisions";
    $("practice-setup").dataset.kind = routineCfg.kind;
    $("rt-start-label").textContent = subsKind ? "Tempo" : "Start tempo";
    $("rt-step-label").textContent = subsKind ? "Step down by" : "Step up by";
    for (const [k, f] of Object.entries(RT_FIELDS)) {
      const b = $(`rt-${k}`);
      b.textContent = String(routineCfg[k]);
      b.setAttribute("aria-label", `${k === "start" && subsKind ? "Tempo" : f.title}: ${routineCfg[k]} ${f.unit}. Tap to change.`);
    }
  }
  for (const [k, f] of Object.entries(RT_FIELDS)) {
    $(`rt-${k}`).addEventListener("click", (e) => {
      openKeypad({
        ...f, value: routineCfg[k], decimals: 0, anchor: e.currentTarget,
        onSet: (v) => { routineCfg[k] = v; clampCfg(); renderRtFields(); renderPreview(); renderRoutines(); saveStore(); },
      });
    });
  }
  $("rt-repeat").addEventListener("click", () => changeLadder("repeat"));
  $("rt-down").addEventListener("click", () => changeLadder("down"));
  $("rt-clean").addEventListener("change", (e) => { if (rt.rateStage !== null) rt.log[rt.rateStage].clean = e.target.checked; });
  $("rt-save").addEventListener("click", () => {
    const session = {
      date: rt.startedAt || new Date().toISOString(),
      routine: routineCfg.name, kind: routineCfg.kind,
      start: routineCfg.start, step: routineCfg.step, top: routineCfg.top, play: routineCfg.play, rest: routineCfg.rest,
      meter: routineMeter().label, subdivision: routineCfg.subdivision, subs: routineCfg.subs.slice(), gaps: routineCfg.gaps,
      stages: rt.log.filter((x) => x.started).map(({ tempo, sub, completed, effort, clean }) => ({ tempo, sub, completed, effort, clean })),
      cleanTempo: Number($("rt-clean-tempo").value) || null,
      notes: $("rt-notes").value.trim(),
    };
    sessions.unshift(session);
    sessions.length = Math.min(sessions.length, 20);
    rt.summaryOpen = false;
    rt.finished = false;
    saveStore();
    log(`Session saved: clean ${session.cleanTempo} BPM`, "info");
    showToast("Session saved");
    renderPractice();
  });
  $("rt-discard").addEventListener("click", () => {
    if (!rt.discardArmed) { rt.discardArmed = true; $("rt-discard").textContent = "Tap again to discard"; return; }
    rt.discardArmed = false;
    $("rt-discard").textContent = "Discard";
    rt.summaryOpen = false;
    rt.finished = false;
    log("Session discarded");
    renderPractice();
  });

  // ---------- routine library ----------
  const ROUTINE_KEYS = ["kind", "start", "step", "top", "play", "rest", "subdivision", "subs", "meterId", "accents", "gaps"];
  const routineUI = { armedDelete: false, naming: null };
  const savedRoutine = () => routines.find((r) => r.id === routineId) || null;
  const routineEdited = () => { const r = savedRoutine(); return !r || ROUTINE_KEYS.some((k) => JSON.stringify(r[k] ?? null) !== JSON.stringify(routineCfg[k] ?? null)); };
  function routineSummary(r) {
    const gap = ROUTINE_GAPS.find((g) => g.id === r.gaps);
    const what = r.kind === "subdivisions" ? `${r.start} BPM · ${r.subs.map((n) => `÷${n}`).join(" ")}` : `${r.start}→${r.top} by ${r.step}${r.subdivision > 1 ? ` · ÷${r.subdivision}` : ""}`;
    return `${what} · ${r.play} s / ${r.rest} s${r.meterId !== "4/4" ? ` · ${r.meterId}` : ""}${r.gaps && r.gaps !== "off" ? ` · gaps ${gap ? gap.label.toLowerCase() : ""}` : ""}`;
  }
  function selectRoutine(r) {
    routineId = r.id;
    for (const k of Object.keys(routineCfg)) delete routineCfg[k];
    Object.assign(routineCfg, JSON.parse(JSON.stringify(r)));
    clampCfg();
    routineUI.armedDelete = false;
    log(`Routine selected: ${r.name}`);
    saveStore();
    renderPractice();
  }
  function renderRoutines() {
    const list = $("rt-routines");
    list.textContent = "";
    for (const r of routines) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "preset-load";
      b.setAttribute("aria-current", String(r.id === routineId));
      const name = document.createElement("span"); name.className = "name"; name.textContent = r.name;
      const sum = document.createElement("span"); sum.className = "sum"; sum.textContent = routineSummary(r.id === routineId ? routineCfg : r);
      b.append(name, sum);
      if (r.note) { const n = document.createElement("span"); n.className = "sum"; n.textContent = r.note; b.append(n); }
      b.addEventListener("click", () => { if (r.id !== routineId) selectRoutine(r); });
      li.append(b);
      list.append(li);
    }
    const edited = routineEdited();
    const cur = savedRoutine();
    $("rt-edited").hidden = !edited || !cur;
    $("rt-update").disabled = !cur || !edited;
    $("rt-update").textContent = "Update";
    $("rt-update").setAttribute("aria-label", cur ? `Update “${cur.name}” with these settings` : "Update routine");
    $("rt-delete").disabled = !cur;
    $("rt-delete").textContent = routineUI.armedDelete ? "Tap again to delete" : "Delete";
    $("rt-rename").disabled = !cur;
  }
  function openRoutineName(mode) {
    routineUI.naming = mode;
    $("rt-name-form").hidden = false;
    $("rt-library-actions").hidden = true;
    $("rt-name-input").value = mode === "rename" ? routineCfg.name : `${routineCfg.name} (mine)`;
    $("rt-name-confirm").textContent = mode === "rename" ? "Rename" : "Save";
    $("rt-name-input").focus();
    $("rt-name-input").select();
  }
  function closeRoutineName() {
    $("rt-name-form").hidden = true;
    $("rt-library-actions").hidden = false;
    routineUI.naming = null;
  }
  $("rt-name-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("rt-name-input").value.trim();
    if (!name) { $("rt-name-input").focus(); return; }
    if (routineUI.naming === "rename") {
      const r = savedRoutine();
      if (r) { r.name = name; routineCfg.name = name; log(`Routine renamed: ${name}`); }
    } else {
      const r = { ...JSON.parse(JSON.stringify(routineCfg)), id: `r-${Date.now().toString(36)}`, name, note: "" };
      routines.push(r);
      routineId = r.id;
      Object.assign(routineCfg, { id: r.id, name, note: "" });
      log(`Routine saved: ${name}`, "info");
      showToast(`Saved “${name}”`);
    }
    closeRoutineName();
    saveStore();
    renderPractice();
  });
  $("rt-name-cancel").addEventListener("click", closeRoutineName);
  $("rt-save-new").addEventListener("click", () => openRoutineName("new"));
  $("rt-rename").addEventListener("click", () => openRoutineName("rename"));
  $("rt-update").addEventListener("click", () => {
    const r = savedRoutine();
    if (!r) return;
    for (const k of ROUTINE_KEYS) r[k] = JSON.parse(JSON.stringify(routineCfg[k] ?? null));
    log(`Routine updated: ${r.name}`, "info");
    showToast(`Updated “${r.name}”`);
    saveStore();
    renderRoutines();
  });
  $("rt-delete").addEventListener("click", () => {
    const r = savedRoutine();
    if (!r) return;
    if (!routineUI.armedDelete) { routineUI.armedDelete = true; renderRoutines(); return; }
    routines.splice(routines.indexOf(r), 1);
    log(`Routine deleted: ${r.name}`);
    routineUI.armedDelete = false;
    if (routines.length) selectRoutine(routines[0]);
    else { routineId = null; saveStore(); renderPractice(); }
  });

  function setWorkspace(name) {
    if (isRunning() || eng.status === "paused") return;
    settings.workspace = name;
    document.documentElement.dataset.workspace = name;
    $("ws-click").setAttribute("aria-pressed", String(name === "click"));
    $("ws-practice").setAttribute("aria-pressed", String(name === "practice"));
    if (name === "click") { $("rail-click").setAttribute("aria-current", "page"); $("rail-practice").removeAttribute("aria-current"); }
    else { $("rail-practice").setAttribute("aria-current", "page"); $("rail-click").removeAttribute("aria-current"); }
    setStatus(eng.status);
    renderPractice();
    saveStore();
  }
  $("ws-click").addEventListener("click", () => setWorkspace("click"));
  $("ws-practice").addEventListener("click", () => setWorkspace("practice"));
  $("rail-click").addEventListener("click", () => setWorkspace("click"));
  $("rail-practice").addEventListener("click", () => setWorkspace("practice"));

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
    const swing = pattern.swingOffset ? ` · swing ${pattern.swing}%` : "";
    $("lcd-pattern").textContent = `${subdivisionName(pattern)}${swing} · ${(allSounds().find((k) => k.id === settings.sound) || SOUNDS[0]).label} · ${countIn}`;
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

  // ---------- gap click ----------
  function currentGaps() {
    if (settings.gapMode === "cycle") return { mode: "cycle", play: settings.gapPlay, mute: settings.gapMute };
    if (settings.gapMode === "random") return { mode: "random", percent: settings.gapPercent, seed: settings.gapSeed };
    return { mode: "off" };
  }
  function gapSummary() {
    if (settings.gapMode === "cycle") return `Play ${settings.gapPlay} bar${settings.gapPlay > 1 ? "s" : ""}, then ${settings.gapMute} silent`;
    if (settings.gapMode === "random") return `About ${settings.gapPercent}% of bars silent · pattern #${settings.gapSeed}`;
    return "Every bar sounds";
  }
  /** Apply new gap settings now: same timing, so nothing already heard moves. */
  function gapsChanged() {
    if ((isRunning() || eng.status === "paused") && eng.plan) eng.plan = eng.plan.withGaps(currentGaps());
    log(`Gap click: ${gapSummary()}`);
    renderGap();
    saveStore();
  }
  function renderGap() {
    const modes = [{ id: "off", label: "Off" }, { id: "cycle", label: "Bars" }, { id: "random", label: "Random" }];
    const pick = (m) => { if (m.id === settings.gapMode) return; settings.gapMode = m.id; gapsChanged(); };
    renderChips($("gap-chips"), modes, (m) => m.id === settings.gapMode, (m) => { pick(m); });
    renderChips($("gap-chips-sheet"), modes, (m) => m.id === settings.gapMode, (m) => { pick(m); });
    $("gap-summary").textContent = gapSummary();
    $("gap-cycle").hidden = settings.gapMode !== "cycle";
    $("gap-random").hidden = settings.gapMode !== "random";
    $("gap-play").textContent = String(settings.gapPlay);
    $("gap-mute").textContent = String(settings.gapMute);
    $("gap-seed").textContent = `#${settings.gapSeed}`;
    renderChips($("gap-percent-chips"), [10, 20, 30, 40, 50].map((n) => ({ id: n, label: `${n}%` })), (x) => x.id === settings.gapPercent, (x) => { settings.gapPercent = x.id; gapsChanged(); });
    $("gap-hide").checked = settings.gapHideLights;
  }
  for (const [id, key, title] of [["gap-play", "gapPlay", "Bars that play"], ["gap-mute", "gapMute", "Silent bars"]]) {
    $(id).addEventListener("click", (e) => openKeypad({
      title, value: settings[key], min: 1, max: 16, decimals: 0, unit: "bars", anchor: e.currentTarget,
      onSet: (v) => { settings[key] = v; gapsChanged(); },
    }));
  }
  $("gap-reseed").addEventListener("click", () => { settings.gapSeed = Math.floor(1000 + Math.random() * 9000); gapsChanged(); });
  $("gap-hide").addEventListener("change", (e) => { settings.gapHideLights = e.target.checked; renderGap(); saveStore(); });

  // ---------- presets ----------
  const presetUI = { editing: false, armedDelete: null, renaming: null, lastFocus: null, anchor: null };
  const snapshot = () => Object.fromEntries(PRESET_FIELDS.map((k) => [k, settings[k] === undefined || settings[k] === null ? null : JSON.parse(JSON.stringify(settings[k]))]));
  // Presets saved before a field existed get its default (gaps off); the random
  // pattern number only matters when the preset has one.
  const PRESET_DEFAULTS = { gapMode: "off", gapPlay: 2, gapMute: 2, gapPercent: 30, swing: 50, grooveOn: false };
  const presetValue = (p, k) => (p[k] !== undefined ? p[k] : PRESET_DEFAULTS[k]);
  const samePreset = (p) => PRESET_FIELDS.every((k) => presetValue(p, k) === undefined || JSON.stringify(presetValue(p, k) ?? null) === JSON.stringify(settings[k] ?? null));
  const currentPreset = () => presets.find((p) => p.id === settings.presetId) || null;
  function presetSummary(p) {
    const m = METERS.find((x) => x.id === p.meterId);
    const kit = allSounds().find((k) => k.id === p.sound);
    const gm = presetValue(p, "gapMode");
    const gaps = gm === "cycle" ? ` · gaps ${presetValue(p, "gapPlay")}/${presetValue(p, "gapMute")}` : gm === "random" ? ` · gaps ${presetValue(p, "gapPercent")}%` : "";
    const sw = presetValue(p, "swing");
    const swing = sw > 50 && T.SWING_SUBDIVISIONS.includes(p.subdivision) ? ` swing ${sw}%` : "";
    return `${fmtBpm(p.bpm)} · ${m ? (m.label || m.id) + (m.note ? ` ${m.note}` : "") : p.meterId}${p.subdivision > 1 ? ` ÷${p.subdivision}` : ""}${swing} · ${kit ? kit.label : isUserSoundId(p.sound) ? "Wood block" : p.sound}${gaps}`;
  }
  function renderPresetCurrent() {
    const p = currentPreset();
    $("preset-name").textContent = p ? p.name : "Not saved";
    $("preset-edited").hidden = !p || samePreset(p);
  }
  // ---------- command centre ----------
  function renderCommandKeys() {
    const running = isRunning();
    const play = $("cc-play");
    play.dataset.state = running ? "running" : eng.status === "paused" ? "paused" : "idle";
    $("cc-play-label").textContent = running ? "Pause" : eng.status === "paused" ? "Resume" : "Play";
    play.querySelector("span[aria-hidden]").textContent = running ? "❚❚" : "▶";
    $("cc-stop").disabled = !(running || eng.status === "paused");
    const i = presets.findIndex((p) => p.id === settings.presetId);
    $("cc-prev").disabled = presets.length < 2 || i <= 0;
    $("cc-next").disabled = presets.length < 2 || i >= presets.length - 1;
    $("cc-countin").setAttribute("aria-pressed", String(settings.countInMode !== "off"));
    $("cc-gap").setAttribute("aria-pressed", String(settings.gapMode !== "off"));
    const meter = currentMeter();
    $("cc-beat1").setAttribute("aria-pressed", String(currentAccents(meter)[0] === L.downbeat));
    $("cc-lock").setAttribute("aria-pressed", String(settings.tempoLock));
    const p = currentPattern();
    $("cc-config").textContent = `${subdivisionName(p)}${p.swingOffset ? ` · swing ${p.swing}%` : ""}${settings.gapMode !== "off" ? " · gaps" : ""}`;
  }
  function songMeta(p) {
    const m = METERS.find((x) => x.id === p.meterId);
    return `${m ? m.label || m.id : p.meterId}`;
  }
  function renderSetlist() {
    const list = $("cc-songs");
    list.textContent = "";
    presets.forEach((p, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cc-song";
      b.setAttribute("aria-current", String(p.id === settings.presetId));
      const kit = allSounds().find((k) => k.id === presetValue(p, "sound"));
      b.innerHTML = "";
      for (const [cls, text] of [["no", String(i + 1).padStart(2, "0")], ["name", p.name], ["bpm-col", `${fmtBpm(p.bpm)} BPM`], ["meta", songMeta(p)]]) {
        const span = document.createElement("span"); span.className = cls; span.textContent = text; b.append(span);
      }
      b.setAttribute("aria-label", `${i + 1}. ${p.name}, ${fmtBpm(p.bpm)} BPM, ${songMeta(p)}${kit ? `, ${kit.label}` : ""}`);
      b.addEventListener("click", () => { if (p.id !== settings.presetId) loadPreset(p); });
      li.append(b);
      list.append(li);
    });
    $("cc-setlist-count").textContent = presets.length ? `· ${presets.length}` : "";
    const i = presets.findIndex((p) => p.id === settings.presetId);
    const next = i >= 0 ? presets[i + 1] : presets[0];
    const after = i >= 0 ? presets[i + 2] : presets[1];
    $("cc-next-name").textContent = next ? next.name : "–";
    $("cc-next-sub").textContent = next ? `${fmtBpm(next.bpm)} BPM · ${songMeta(next)}` : "End of list";
    $("cc-after-name").textContent = after ? after.name : "–";
    $("cc-after-sub").textContent = after ? `${fmtBpm(after.bpm)} BPM · ${songMeta(after)}` : "";
    const notes = $("cc-notes");
    const cur = currentPreset();
    notes.disabled = !cur;
    if (document.activeElement !== notes) notes.value = cur ? presetNotes[cur.id] || "" : "";
    $("cc-notes-state").textContent = cur ? `${cur.name} · saved automatically` : "Save the setup as a song to keep notes";
    renderCommandKeys();
    if (chart.tab === "chart") showChart();
  }
  let notesTimer = null;
  $("cc-notes").addEventListener("input", (e) => {
    const cur = currentPreset();
    if (!cur) return;
    presetNotes[cur.id] = e.target.value;
    clearTimeout(notesTimer);
    notesTimer = setTimeout(saveStore, 400);
  });
  function stepSong(dir) {
    const i = presets.findIndex((p) => p.id === settings.presetId);
    const target = presets[i < 0 ? 0 : i + dir];
    if (target) loadPreset(target);
  }
  $("cc-play").addEventListener("click", () => (isRunning() ? pause() : eng.status === "paused" ? start(true) : start()));
  $("cc-stop").addEventListener("click", () => stop());
  $("cc-prev").addEventListener("click", () => stepSong(-1));
  $("cc-next").addEventListener("click", () => stepSong(1));
  $("cc-countin").addEventListener("click", () => {
    settings.countInMode = settings.countInMode === "off" ? "every" : "off";
    log(`Count-in: ${settings.countInMode === "off" ? "off" : "every start"}`);
    renderSetup(); renderCommandKeys(); saveStore();
  });
  $("cc-gap").addEventListener("click", () => {
    settings.gapMode = settings.gapMode === "off" ? (settings.lastGapMode || "cycle") : "off";
    if (settings.gapMode !== "off") settings.lastGapMode = settings.gapMode;
    gapsChanged(); renderCommandKeys();
  });
  $("cc-beat1").addEventListener("click", () => {
    const meter = currentMeter();
    const accents = currentAccents(meter).slice();
    accents[0] = accents[0] === L.downbeat ? (meter.grouping[0] > 1 ? L.group : L.normal) : L.downbeat;
    settings.accents = accents;
    queueChange("pattern"); renderBeats(); renderActiveBeat(); renderCommandKeys(); saveStore();
  });
  $("cc-lock").addEventListener("click", () => {
    settings.tempoLock = !settings.tempoLock;
    log(`Tempo lock: ${settings.tempoLock ? "on" : "off"}`);
    renderCommandKeys(); saveStore();
  });
  // Panic restart: stop everything, then start again cleanly from the count-in.
  $("cc-panic").addEventListener("click", async () => {
    log("Panic restart", "warn");
    if (isRunning() || eng.status === "paused" || eng.status === "interrupted") stop();
    hideBanner();
    await start();
  });
  $("cc-add").addEventListener("click", () => { openPresets($("cc-manage")); openPresetName("new"); });
  $("cc-manage").addEventListener("click", (e) => ($("presets").hidden ? openPresets(e.currentTarget) : closePresets()));

  function applyLayout() {
    document.documentElement.dataset.layout = settings.layout;
  }

  function renderPresets() {
    if (document.getElementById("cc-songs")) renderSetlist();
    renderPresetCurrent();
    const list = $("preset-list");
    list.textContent = "";
    if (!presets.length) {
      const li = document.createElement("li");
      li.className = "hint";
      li.textContent = "No presets yet. Set up the click, then Save as new.";
      list.append(li);
    }
    for (const p of presets) {
      const li = document.createElement("li");
      li.className = "preset-item";
      const load = document.createElement("button");
      load.type = "button";
      load.className = "preset-load";
      load.setAttribute("aria-current", String(p.id === settings.presetId));
      const name = document.createElement("span"); name.className = "name"; name.textContent = p.name;
      const sum = document.createElement("span"); sum.className = "sum"; sum.textContent = presetSummary(p);
      load.append(name, sum);
      load.addEventListener("click", () => { if (!presetUI.editing) loadPreset(p); });
      li.append(load);
      if (presetUI.editing) {
        const ren = document.createElement("button");
        ren.type = "button"; ren.className = "btn"; ren.textContent = "Rename";
        ren.addEventListener("click", () => openPresetName("rename", p));
        const del = document.createElement("button");
        del.type = "button"; del.className = "btn danger";
        del.textContent = presetUI.armedDelete === p.id ? "Delete?" : "Delete";
        del.setAttribute("aria-label", presetUI.armedDelete === p.id ? `Tap again to delete ${p.name}` : `Delete ${p.name}`);
        del.addEventListener("click", () => {
          if (presetUI.armedDelete !== p.id) { presetUI.armedDelete = p.id; renderPresets(); return; }
          presets.splice(presets.indexOf(p), 1);
          chartDelete(p.id);
          if (settings.presetId === p.id) settings.presetId = null;
          presetUI.armedDelete = null;
          log(`Preset deleted: ${p.name}`);
          saveStore();
          renderPresets();
        });
        li.append(ren, del);
      }
      list.append(li);
    }
    const cur = currentPreset();
    const update = $("preset-update");
    update.disabled = !cur || samePreset(cur);
    update.textContent = cur ? `Update “${cur.name}”` : "Update preset";
    $("presets-edit").setAttribute("aria-pressed", String(presetUI.editing));
    $("presets-edit").textContent = presetUI.editing ? "Finish editing" : "Edit";
  }
  function loadPreset(p) {
    for (const k of PRESET_FIELDS) {
      const v = presetValue(p, k);
      if (v !== undefined) settings[k] = v && typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v;
    }
    if (!settings.mix) settings.mix = defaultMix();
    // A song can name a sound you have since deleted (or that isn't on this device).
    if (!allSounds().some((k) => k.id === settings.sound)) settings.sound = "wood";
    settings.presetId = p.id;
    log(`Preset loaded: ${p.name}`);
    renderTempo();
    renderSetup();
    renderGap();
    if ((isRunning() || eng.status === "paused") && eng.plan) eng.plan = eng.plan.withGaps(currentGaps());
    if (isRunning()) queueChange("pattern");
    renderBeats();
    renderTempoNote();
    saveStore();
    renderPresets();
    renderGroove();
    applyMix();
    closePresets();
  }
  function openPresetName(mode, p) {
    presetUI.renaming = mode === "rename" ? p.id : null;
    const input = $("preset-name-input");
    input.value = mode === "rename" ? p.name : `${fmtBpm(settings.bpm)} BPM ${currentMeter().label}`;
    $("preset-save-form").hidden = false;
    $("preset-actions").hidden = true;
    $("preset-save-confirm").textContent = mode === "rename" ? "Rename" : "Save";
    input.focus();
    input.select();
  }
  function closePresetName() {
    $("preset-save-form").hidden = true;
    $("preset-actions").hidden = false;
    presetUI.renaming = null;
  }
  $("preset-save-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("preset-name-input").value.trim();
    if (!name) { $("preset-name-input").focus(); return; }
    if (presetUI.renaming) {
      const p = presets.find((x) => x.id === presetUI.renaming);
      if (p) { log(`Preset renamed: ${p.name} → ${name}`); p.name = name; }
    } else {
      const p = { id: `p-${Date.now().toString(36)}`, name, ...snapshot() };
      presets.push(p);
      settings.presetId = p.id;
      log(`Preset saved: ${name}`, "info");
      showToast(`Saved “${name}”`);
    }
    closePresetName();
    saveStore();
    renderPresets();
  });
  $("preset-save-cancel").addEventListener("click", closePresetName);
  $("preset-save-new").addEventListener("click", () => openPresetName("new"));
  $("preset-update").addEventListener("click", () => {
    const p = currentPreset();
    if (!p) return;
    Object.assign(p, snapshot());
    log(`Preset updated: ${p.name}`, "info");
    showToast(`Updated “${p.name}”`);
    saveStore();
    renderPresets();
  });
  $("presets-edit").addEventListener("click", () => { presetUI.editing = !presetUI.editing; presetUI.armedDelete = null; renderPresets(); });
  function openPresets(anchor) {
    presetUI.lastFocus = document.activeElement;
    presetUI.anchor = anchor;
    presetUI.editing = false;
    presetUI.armedDelete = null;
    closePresetName();
    renderPresets();
    const el = $("presets");
    el.hidden = false;
    $("open-presets").setAttribute("aria-expanded", "true");
    const a = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(16, a.right - el.offsetWidth), window.innerWidth - el.offsetWidth - 16);
    el.style.left = `${left}px`;
    el.style.top = `${Math.max(16, a.bottom + 8)}px`;
    $("presets-title").setAttribute("tabindex", "-1");
    $("presets-title").focus({ preventScroll: true });
  }
  function closePresets() {
    if ($("presets").hidden) return;
    $("presets").hidden = true;
    $("open-presets").setAttribute("aria-expanded", "false");
    if (presetUI.lastFocus && document.contains(presetUI.lastFocus)) presetUI.lastFocus.focus({ preventScroll: true });
  }
  $("open-presets").addEventListener("click", (e) => ($("presets").hidden ? openPresets(e.currentTarget) : closePresets()));
  $("open-presets-sheet").addEventListener("click", () => { closeSettings(); openPresets($("open-settings")); });
  $("presets-close").addEventListener("click", closePresets);
  document.addEventListener("pointerdown", (e) => {
    if (!$("presets").hidden && !e.target.closest("#presets, #open-presets, #open-presets-sheet, .transport")) closePresets();
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("presets").hidden && $("preset-save-form").hidden) closePresets(); });

  // Short confirmations (HIG › Feedback: confirm significant actions).
  let toastTimer = null;
  function showToast(text) {
    const el = $("hiccup");
    el.textContent = text;
    el.hidden = false;
    el.classList.remove("fading");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.add("fading"); setTimeout(() => { el.hidden = true; el.classList.remove("fading"); }, 400); }, 2000);
  }

  // ---------- design concepts ----------
  function applyConcept() {
    document.documentElement.dataset.concept = settings.concept;
    saveStore();
  }
  // ---------- settings sheet ----------
  // Non-modal on purpose: it stops above the transport so Stop always works
  // while it's open (Docs/UX.md principle 4). Esc, Done or the backdrop close it.
  const TABS = ["click", "sound", "look", "ipad", "test"];
  let lastFocus = null;
  function fitSheet() {
    const h = document.querySelector(".transport").offsetHeight;
    $("settings").style.bottom = `${h}px`;
    $("settings-scrim").style.bottom = `${h}px`;
  }
  function openSettings(tab) {
    lastFocus = document.activeElement;
    fitSheet();
    $("settings").hidden = false;
    $("settings-scrim").hidden = false;
    $("open-settings").setAttribute("aria-expanded", "true");
    selectTab(tab || settings.settingsTab || "click", false);
    $("settings-title").setAttribute("tabindex", "-1");
    $("settings-title").focus();
  }
  function closeSettings() {
    if ($("settings").hidden) return;
    $("settings").hidden = true;
    $("settings-scrim").hidden = true;
    $("open-settings").setAttribute("aria-expanded", "false");
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  }
  function selectTab(name, focus = true) {
    for (const t of TABS) {
      const on = t === name;
      const tab = $(`tab-${t}`);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      $(`pane-${t}`).hidden = !on;
      if (on && focus) tab.focus();
    }
    settings.settingsTab = name;
    $("settings").querySelector(".sheet-body").scrollTop = 0;
    saveStore();
  }
  $("open-settings").addEventListener("click", () => ($("settings").hidden ? openSettings() : closeSettings()));
  $("close-settings").addEventListener("click", closeSettings);
  $("settings-scrim").addEventListener("click", closeSettings);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("settings").hidden) { e.preventDefault(); closeSettings(); } });
  for (const t of TABS) {
    $(`tab-${t}`).addEventListener("click", () => selectTab(t));
    $(`tab-${t}`).addEventListener("keydown", (e) => {
      const i = TABS.indexOf(t);
      if (e.key === "ArrowRight") { e.preventDefault(); selectTab(TABS[(i + 1) % TABS.length]); }
      if (e.key === "ArrowLeft") { e.preventDefault(); selectTab(TABS[(i + TABS.length - 1) % TABS.length]); }
    });
  }
  window.addEventListener("resize", () => { if (!$("settings").hidden) fitSheet(); });


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
      if (next !== Math.round(settings.bpm) && !settings.tempoLock) setBpm(next);
    });
    for (const type of ["pointerup", "pointercancel"]) dial.addEventListener(type, () => { drag = null; });
    dial.addEventListener("keydown", (e) => {
      const step = settings.tempoLock ? undefined : { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
      if (step) { e.preventDefault(); setBpm(Math.round(settings.bpm) + step); }
      if (e.key === "Home") { e.preventDefault(); setBpm(T.TEMPO_MIN); }
      if (e.key === "End") { e.preventDefault(); setBpm(T.TEMPO_MAX); }
    });
  })();

  // ---------- sound preview ----------
  // One count-in click, then a bar of 4/4 with eighths: strong, sub, normal, sub…
  // Plays only while stopped, from the tap that picked the sound.
  let previewSources = [];
  async function previewSound() {
    try {
      setAudioSession();
      ensureAudio();
      if (eng.ctx.state !== "running") await eng.ctx.resume();
      if (eng.ctx.state !== "running" || isRunning()) return;
      for (const src of previewSources) { try { src.stop(); } catch { /* done */ } }
      previewSources = [];
      const kit = kitBuffers(settings.sound);
      const beat = 0.5; // 120 BPM
      const t0 = eng.ctx.currentTime + 0.06;
      const steps = [["countIn", -beat * 1.5]];
      [L.downbeat, L.sub, L.normal, L.sub, L.normal, L.sub, L.normal, L.sub].forEach((lv, i) => steps.push([lv, i * beat / 2]));
      for (const [lv, offset] of steps) {
        const src = eng.ctx.createBufferSource();
        src.buffer = pickTake(kit, lv);
        src.connect(lv === L.sub ? eng.subGain : eng.bus.click.in);
        src.start(t0 + beat * 1.5 + offset);
        previewSources.push(src);
      }
    } catch (e) { log(`Preview failed: ${e.message}`, "warn"); }
  }
  $("preview-sound").addEventListener("click", () => { if (!isRunning()) previewSound(); });
  $("sub-volume").value = String(settings.subVolume);
  $("sub-volume-out").textContent = `${settings.subVolume}%`;
  $("sub-volume").addEventListener("input", (e) => {
    settings.subVolume = Number(e.target.value);
    $("sub-volume-out").textContent = `${settings.subVolume}%`;
    if (eng.subGain) eng.subGain.gain.setTargetAtTime(Math.pow(settings.subVolume / 100, 2), eng.ctx.currentTime, 0.015);
    saveStore();
  });



  // ---------- your sounds (imported recordings) ----------
  // A file from the Files app becomes a click sound: the same clean-up as the
  // built-in samples (onset first, tail trimmed, loudness matched), stored on
  // this device in IndexedDB. One file is the beat; an optional second file is
  // the accent (bar one and group accents). Subdivisions use the beat, quieter.
  const USER_SOUND_MAX_BYTES = 20 * 1024 * 1024;
  const USER_SOUND_MAX = 12;
  const USER_SOUND_MAX_SECONDS = 1.0;
  let soundDb = null;
  const memSounds = {};
  let userSoundTarget = "new"; // what the file picker is for: "new" or "accent"
  let userSoundDeleteArmed = null;
  function openSoundDb() {
    if (soundDb) return soundDb;
    soundDb = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("no IndexedDB")); return; }
      const req = indexedDB.open("pocket-sounds", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("sounds");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    soundDb.catch(() => {});
    return soundDb;
  }
  async function soundStore(mode, fn) {
    const db = await openSoundDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sounds", mode);
      const req = fn(tx.objectStore("sounds"));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function soundAll() {
    try { return (await soundStore("readonly", (st) => st.getAll())) || []; } catch { return Object.values(memSounds); }
  }
  async function soundPut(rec) {
    try { await soundStore("readwrite", (st) => st.put(rec, rec.id)); return true; } catch { memSounds[rec.id] = rec; return false; }
  }
  async function soundDelete(id) {
    delete memSounds[id];
    try { await soundStore("readwrite", (st) => st.delete(id)); } catch { /* nothing stored */ }
  }

  /** Stored record → kit entry plus the takes `kitBuffers` builds voices from. */
  function useUserSound(rec) {
    const beat = { sr: rec.sr, data: rec.beat };
    const accent = rec.accent ? { sr: rec.sr, data: rec.accent } : beat;
    decodedSamples[rec.id] = { downbeat: [accent], group: [accent], normal: [beat], sub: [beat] };
    if (eng.buffers) delete eng.buffers[rec.id];
    const meta = { id: rec.id, label: rec.label, note: rec.accent ? "beat + accent" : "your recording", recorded: true, user: true, added: rec.added };
    userKits = userKits.filter((k) => k.id !== rec.id).concat(meta).sort((a, b) => a.added - b.added);
  }
  async function loadUserSounds() {
    for (const rec of await soundAll()) {
      if (rec && rec.beat && rec.sr) useUserSound(rec);
    }
    if (isUserSoundId(settings.sound) && !userKits.some((k) => k.id === settings.sound)) {
      log("A sound you added is no longer on this device; using Wood block.", "warn");
      settings.sound = "wood";
      saveStore();
    }
    rebuildBuffers();
    renderSetup();
    renderLcd();
  }

  /** Any audio file the browser can decode → mono samples. WAV also decodes without Web Audio. */
  async function decodeAudioFile(bytes) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (Offline) {
      try {
        const ctx = new Offline(1, 1, 48000);
        const buf = await new Promise((resolve, reject) => {
          const p = ctx.decodeAudioData(bytes.slice(0), resolve, reject);
          if (p && p.then) p.then(resolve, reject);
        });
        const data = new Float32Array(buf.length);
        for (let c = 0; c < buf.numberOfChannels; c++) {
          const ch = buf.getChannelData(c);
          for (let i = 0; i < ch.length; i++) data[i] += ch[i] / buf.numberOfChannels;
        }
        return { sr: buf.sampleRate, data };
      } catch { /* try the WAV reader */ }
    }
    return SND.decodeWav(new Uint8Array(bytes));
  }
  function userSoundStatus(text, isError = false) {
    const el = $("user-sound-status");
    el.textContent = text;
    el.classList.toggle("error", isError);
  }
  async function importUserSound(file) {
    if (file.size > USER_SOUND_MAX_BYTES) { userSoundStatus("That file is over 20 MB. Pick a short recording of a single hit."); return; }
    const target = userSoundTarget;
    const editing = target === "accent" ? userKits.find((k) => k.id === settings.sound) : null;
    if (target === "accent" && !editing) return;
    if (target === "new" && userKits.length >= USER_SOUND_MAX) { userSoundStatus(`You can keep ${USER_SOUND_MAX} sounds. Delete one to add another.`, true); return; }
    userSoundStatus("Reading the file…");
    let clip;
    try {
      const raw = await decodeAudioFile(await file.arrayBuffer());
      if (!raw.data.length) throw new Error("empty");
      clip = SND.prepareSample(raw, USER_SOUND_MAX_SECONDS);
      if (clip.rawPeak < 0.001) { userSoundStatus("That recording is silent. Pick a file with a clear hit.", true); return; }
      clip.sr = raw.sr;
    } catch {
      userSoundStatus("POCKET couldn't read that file. Use a WAV, AIFF, MP3 or M4A recording.", true);
      return;
    }
    const all = await soundAll();
    let rec;
    if (editing) {
      rec = all.find((r) => r.id === editing.id) || memSounds[editing.id];
      if (!rec) return;
      // Both takes share one sample rate; resample the accent if the files differ.
      rec = { ...rec, accent: clip.sr === rec.sr ? clip.y : resampleLinear(clip.y, clip.sr, rec.sr) };
    } else {
      const label = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 28) || "My sound";
      rec = { id: `user-${Date.now().toString(36)}`, label, sr: clip.sr, beat: clip.y, accent: null, added: Date.now() };
    }
    const saved = await soundPut(rec);
    useUserSound(rec);
    settings.sound = rec.id;
    rebuildBuffers();
    saveStore();
    renderSetup();
    renderLcd();
    const len = Math.round((clip.y.length / clip.sr) * 1000);
    userSoundStatus(`${editing ? `Accent added to ${rec.label}` : `Added ${rec.label}`} (${len} ms, starts on the hit).${saved ? "" : " This browser can't store it, so it lasts until you close POCKET."}`);
    log(`Sound added: ${rec.label}${editing ? " (accent)" : ""}, ${len} ms`);
    if (!isRunning()) previewSound();
  }
  function resampleLinear(data, from, to) {
    const n = Math.max(1, Math.round((data.length * to) / from));
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * from) / to, k = Math.floor(x), f = x - k;
      out[i] = (data[k] || 0) * (1 - f) + (data[k + 1] || 0) * f;
    }
    return out;
  }
  function renderUserSoundActions() {
    const mine = userKits.find((k) => k.id === settings.sound);
    $("user-sounds-empty").hidden = userKits.length > 0;
    $("user-sound-accent").hidden = !mine;
    $("user-sound-delete").hidden = !mine;
    if (mine) $("user-sound-accent").textContent = mine.note === "beat + accent" ? "Replace accent…" : "Add accent…";
    if (!mine || userSoundDeleteArmed !== mine.id) { $("user-sound-delete").textContent = "Delete"; userSoundDeleteArmed = null; }
  }
  $("user-sound-add").addEventListener("click", () => { userSoundTarget = "new"; $("user-sound-file").click(); });
  $("user-sound-accent").addEventListener("click", () => { userSoundTarget = "accent"; $("user-sound-file").click(); });
  $("user-sound-file").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) importUserSound(file);
  });
  $("user-sound-delete").addEventListener("click", async () => {
    const mine = userKits.find((k) => k.id === settings.sound);
    if (!mine) return;
    if (userSoundDeleteArmed !== mine.id) {
      userSoundDeleteArmed = mine.id;
      $("user-sound-delete").textContent = "Tap again to delete";
      setTimeout(() => { if (userSoundDeleteArmed === mine.id) { userSoundDeleteArmed = null; renderUserSoundActions(); } }, 3000);
      return;
    }
    userSoundDeleteArmed = null;
    await soundDelete(mine.id);
    userKits = userKits.filter((k) => k.id !== mine.id);
    delete decodedSamples[mine.id];
    settings.sound = "wood";
    rebuildBuffers();
    saveStore();
    renderSetup();
    renderLcd();
    userSoundStatus(`Deleted ${mine.label}. Songs that used it now play Wood block.`);
    log(`Sound deleted: ${mine.label}`);
  });
  loadUserSounds();

  // ---------- charts (plan §08: a PDF chart per song) ----------
  // Stored on this device in IndexedDB, keyed by the song's preset id. pdf.js
  // (src/vendor/pdfjs) is started the first time a chart is shown. Pages turn with
  // the buttons, a tap on the left or right third of the page, ←/→ or Page Up/Down
  // (what most Bluetooth page-turner pedals send).
  const chart = { tab: "notes", doc: null, docFor: null, page: 1, pages: 0, task: null, drawn: "", pageBySong: {}, fitWidth: false, removeArmed: null };
  const memCharts = {};
  let chartDb = null;
  function openChartDb() {
    if (chartDb) return chartDb;
    chartDb = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("no IndexedDB")); return; }
      const req = indexedDB.open("pocket-charts", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("charts");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    chartDb.catch(() => {});
    return chartDb;
  }
  async function chartStore(mode, fn) {
    const db = await openChartDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("charts", mode);
      const req = fn(tx.objectStore("charts"));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  async function chartGet(id) {
    try { return (await chartStore("readonly", (s) => s.get(id))) || null; } catch { return memCharts[id] || null; }
  }
  async function chartPut(id, rec) {
    try { await chartStore("readwrite", (s) => s.put(rec, id)); return true; } catch { memCharts[id] = rec; return false; }
  }
  async function chartDelete(id) {
    delete memCharts[id];
    try { await chartStore("readwrite", (s) => s.delete(id)); } catch { /* nothing stored */ }
    if (chart.docFor === id) closeChartDoc();
  }
  function closeChartDoc() {
    if (chart.task) { try { chart.task.cancel(); } catch { /* done */ } chart.task = null; }
    if (chart.doc) { try { chart.doc.destroy(); } catch { /* gone */ } }
    chart.doc = null; chart.docFor = null; chart.pages = 0; chart.drawn = "";
  }
  function pdfLib() {
    if (!window.pdfjsLib) {
      const s = document.createElement("script");
      s.textContent = $("pdfjs-src").textContent;
      document.head.append(s);
      if (!window.pdfjsLib) throw new Error("the PDF viewer did not load");
      const worker = new Blob([$("pdfjs-worker-src").textContent], { type: "text/javascript" });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(worker);
    }
    return window.pdfjsLib;
  }
  async function openPdf(data) {
    const lib = pdfLib();
    try {
      return await lib.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false }).promise;
    } catch (e) {
      // Some hosts block worker threads; pdf.js then runs on this thread if its
      // worker code is already loaded here.
      if (window.pdfjsWorker) throw e;
      const s = document.createElement("script");
      s.textContent = $("pdfjs-worker-src").textContent;
      document.head.append(s);
      log(`Chart viewer: running without a worker (${e.message})`, "warn");
      return lib.getDocument({ data: new Uint8Array(data.slice(0)), isEvalSupported: false }).promise;
    }
  }

  function selectNotesTab(tab) {
    chart.tab = tab;
    $("cc-tab-notes").setAttribute("aria-selected", String(tab === "notes"));
    $("cc-tab-chart").setAttribute("aria-selected", String(tab === "chart"));
    $("cc-notes-panel").hidden = tab !== "notes";
    $("cc-chart").hidden = tab !== "chart";
    $("cc-notes-panel").dataset.tab = tab;
    if (tab === "chart") showChart();
    else renderSetlist();
  }
  function chartMessage(text) {
    $("chart-empty").textContent = text;
    $("chart-empty").hidden = false;
    $("chart-canvas").hidden = true;
    $("chart-page").textContent = "–";
    $("chart-prev").disabled = $("chart-next").disabled = true;
  }
  let chartShowing = 0;
  async function showChart() {
    const ticket = ++chartShowing;
    const cur = currentPreset();
    $("chart-add").disabled = !cur;
    if (!cur) { closeChartDoc(); $("chart-remove").hidden = true; chartMessage("Save this setup as a song to add a chart."); $("cc-notes-state").textContent = "No song selected"; return; }
    if (chart.docFor !== cur.id) {
      closeChartDoc();
      const rec = await chartGet(cur.id);
      if (ticket !== chartShowing) return;
      $("chart-add").textContent = rec ? "Replace chart" : "Add chart (PDF)";
      $("chart-remove").hidden = !rec;
      if (!rec) { chartMessage("No chart for this song yet. Add a PDF."); $("cc-notes-state").textContent = `${cur.name} · no chart`; return; }
      chartMessage("Opening chart…");
      try {
        const doc = await openPdf(rec.data);
        if (ticket !== chartShowing) { doc.destroy(); return; }
        chart.doc = doc; chart.docFor = cur.id; chart.pages = doc.numPages; chart.name = rec.name;
        chart.page = Math.min(chart.pageBySong[cur.id] || 1, chart.pages);
      } catch (e) {
        chartMessage(`This PDF could not be opened (${e.message}). Try exporting it again.`);
        log(`Chart failed to open: ${e.message}`, "warn");
        return;
      }
    }
    $("cc-notes-state").textContent = `${cur.name} · ${chart.name}`;
    await drawChartPage();
  }
  async function drawChartPage() {
    if (!chart.doc) return;
    const view = $("chart-view"), canvas = $("chart-canvas");
    const key = `${chart.docFor}:${chart.page}:${view.clientWidth}x${view.clientHeight}:${chart.fitWidth}`;
    $("chart-page").textContent = `Page ${chart.page} of ${chart.pages}`;
    $("chart-prev").disabled = chart.page <= 1;
    $("chart-next").disabled = chart.page >= chart.pages;
    if (key === chart.drawn) return;
    if (chart.task) { try { chart.task.cancel(); } catch { /* done */ } }
    const page = await chart.doc.getPage(chart.page);
    const base = page.getViewport({ scale: 1 });
    const w = Math.max(100, view.clientWidth - 16), h = Math.max(100, view.clientHeight - 16);
    const scale = chart.fitWidth ? w / base.width : Math.min(w / base.width, h / base.height);
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: scale * dpr });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
    canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
    chart.task = page.render({ canvasContext: canvas.getContext("2d"), viewport: vp });
    try {
      await chart.task.promise;
      chart.drawn = key;
      canvas.hidden = false;
      $("chart-empty").hidden = true;
      view.scrollTop = 0;
    } catch (e) {
      if (e && e.name !== "RenderingCancelledException") log(`Chart page failed: ${e.message}`, "warn");
    } finally { chart.task = null; }
  }
  function turnChartPage(dir) {
    if (!chart.doc) return;
    const next = Math.min(chart.pages, Math.max(1, chart.page + dir));
    if (next === chart.page) return;
    chart.page = next;
    chart.pageBySong[chart.docFor] = next;
    drawChartPage();
  }

  $("cc-tab-notes").addEventListener("click", () => selectNotesTab("notes"));
  $("cc-tab-chart").addEventListener("click", () => selectNotesTab("chart"));
  for (const id of ["cc-tab-notes", "cc-tab-chart"]) {
    $(id).addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const other = id === "cc-tab-notes" ? "cc-tab-chart" : "cc-tab-notes";
      $(other).focus(); $(other).click();
    });
  }
  $("chart-prev").addEventListener("click", () => turnChartPage(-1));
  $("chart-next").addEventListener("click", () => turnChartPage(1));
  $("chart-fit").addEventListener("click", () => {
    chart.fitWidth = !chart.fitWidth;
    $("chart-fit").setAttribute("aria-pressed", String(chart.fitWidth));
    drawChartPage();
  });
  $("chart-view").addEventListener("click", (e) => {
    if (!chart.doc) return;
    const r = $("chart-view").getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (x < 1 / 3) turnChartPage(-1);
    else if (x > 2 / 3) turnChartPage(1);
  });
  document.addEventListener("keydown", (e) => {
    if (chart.tab !== "chart" || !chart.doc || settings.layout !== "dense" || keypad.open) return;
    if (e.target.closest("input, textarea, select, [role=slider], [role=tab]") || !$("settings").hidden) return;
    const dir = { PageDown: 1, PageUp: -1, ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (dir) { e.preventDefault(); turnChartPage(dir); }
  });
  $("chart-add").addEventListener("click", () => { if (currentPreset()) $("chart-file").click(); });
  $("chart-file").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    const cur = currentPreset();
    if (!file || !cur) return;
    if (file.size > 40 * 1024 * 1024) { showToast("That PDF is over 40 MB. Export a smaller copy and try again."); return; }
    const data = await file.arrayBuffer();
    const head = new TextDecoder().decode(new Uint8Array(data.slice(0, 1024)));
    if (!head.includes("%PDF")) { showToast("That file isn't a PDF."); return; }
    const saved = await chartPut(cur.id, { name: file.name.replace(/\.pdf$/i, ""), data, added: new Date().toISOString(), size: file.size });
    log(`Chart added to ${cur.name}: ${file.name}${saved ? "" : " (kept until reload: this browser blocks storage)"}`, saved ? "" : "warn");
    chart.pageBySong[cur.id] = 1;
    closeChartDoc();
    showChart();
  });
  $("chart-remove").addEventListener("click", () => {
    const cur = currentPreset();
    if (!cur) return;
    if (chart.removeArmed !== cur.id) {
      chart.removeArmed = cur.id;
      $("chart-remove").textContent = "Tap again to remove";
      setTimeout(() => { if (chart.removeArmed === cur.id) { chart.removeArmed = null; $("chart-remove").textContent = "Remove"; } }, 3000);
      return;
    }
    chart.removeArmed = null;
    $("chart-remove").textContent = "Remove";
    chartDelete(cur.id).then(() => { log(`Chart removed from ${cur.name}`); showChart(); });
  });
  let chartResize = null;
  window.addEventListener("resize", () => { clearTimeout(chartResize); chartResize = setTimeout(() => { if (chart.tab === "chart") drawChartPage(); }, 150); });

  // ---------- grooves (plan §08, M3) ----------
  // A groove is a short drum pattern on a 16th grid (two steps per eighth in /8
  // meters). It plays with the click on the same clock and follows its tempo,
  // meter changes, swing and gap bars (timing.js grooveEventsIn); it is silent
  // in the count-in. Lanes are strings: "." rest, "g" ghost, "x" hit, "X" accent.
  // Recorded voices: web/samples/drums (VCSL, CC0). See Docs/DESIGN.md › Grooves.
  function makeBus() {
    const ctx = eng.ctx;
    const gain = ctx.createGain();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { gain.connect(pan); pan.connect(eng.master); } else gain.connect(eng.master);
    return { in: gain, gain, pan };
  }
  const mixGain = (m) => (m.m ? 0 : Math.pow(m.v / 80, 2));
  function applyMix(instant = false) {
    if (!eng.bus) return;
    const now = eng.ctx.currentTime;
    for (const ch of CHANNELS) {
      const m = settings.mix[ch.id], bus = eng.bus[ch.id];
      if (instant) { bus.gain.gain.value = mixGain(m); if (bus.pan) bus.pan.pan.value = m.p / 50; continue; }
      bus.gain.gain.setTargetAtTime(mixGain(m), now, 0.015);
      if (bus.pan) bus.pan.pan.setTargetAtTime(m.p / 50, now, 0.015);
    }
  }

  const DRUM_LEVEL_GAIN = { 1: 0.45, 2: 1, 3: 1.35 };
  const DRUM_LEVELS = { 1: "ghost", 2: "normal", 3: "accent" };
  function drumBuffers() {
    if (eng.drums) return eng.drums;
    const ctx = eng.ctx;
    eng.drums = {};
    for (const v of DRUM_VOICES) {
      eng.drums[v.id] = {};
      for (const [n, name] of Object.entries(DRUM_LEVELS)) {
        eng.drums[v.id][n] = (v.levels[name] || v.levels.normal).map((b64) => {
          const w = SND.decodeWav(SND.fromBase64(b64));
          const b = ctx.createBuffer(1, w.data.length, w.sr);
          const out = b.getChannelData(0), g = DRUM_LEVEL_GAIN[n];
          for (let i = 0; i < w.data.length; i++) out[i] = w.data[i] * g;
          return b;
        });
      }
    }
    return eng.drums;
  }
  const drumTurns = {};
  // The kick lane plays either voice: a synthesized kit kick (default) or the
  // recorded concert bass drum.
  const KICK_VOICES = [{ id: "kickkit", label: "Kit", note: "synthesized" }, { id: "kick", label: "Concert", note: "recorded" }];
  const voiceFor = (lane) => (lane === "kick" ? settings.kickVoice : lane);
  function drumTake(lane, level) {
    const voice = voiceFor(lane);
    const takes = (drumBuffers()[voice] || drumBuffers()[lane])[level];
    const key = voice + level;
    drumTurns[key] = ((drumTurns[key] || 0) + 1) % takes.length;
    return takes[drumTurns[key]];
  }
  /** One drum hit. Closed hat (or the next open hat) chokes a ringing open hat. */
  function playDrum(lane, level, time) {
    const ctx = eng.ctx;
    const src = ctx.createBufferSource();
    src.buffer = drumTake(lane, level);
    let dest = eng.bus[LANE_BUS[lane]].in;
    if ((lane === "hat" || lane === "open") && eng.openHat && time > eng.openHat.time) {
      eng.openHat.gain.gain.setTargetAtTime(0, time, 0.012);
      eng.openHat = null;
    }
    if (lane === "open") {
      const g = ctx.createGain();
      g.connect(dest);
      dest = g;
      eng.openHat = { gain: g, time };
    }
    src.connect(dest);
    src.start(time);
    eng.sources.add(src);
    src.onended = () => eng.sources.delete(src);
  }

  const grooveSounds = () => settings.grooveOn && settings.workspace !== "practice" && !rt.active && DRUM_VOICES.length > 0;
  function scheduleGroove(from, to) {
    for (const h of eng.plan.grooveEventsIn(from, to, compiledGroove())) {
      if (h.lane === "_step") { eng.grooveVisual.push({ time: h.time, step: h.step }); continue; }
      playDrum(h.lane, h.level, h.time);
    }
  }

  const LANES = [
    { id: "kick", label: "Kick" }, { id: "snare", label: "Snare" }, { id: "hat", label: "Hi-hat" },
    { id: "open", label: "Open hat" }, { id: "shaker", label: "Shaker" }, { id: "tamb", label: "Tambourine" },
  ];
  const LANE_BUS = { kick: "kick", snare: "snare", hat: "hat", open: "hat", shaker: "shaker", tamb: "tamb" };
  const STARTER_GROOVES = [
    { id: "g-rock8", name: "Rock eighths", meterId: "4/4", note: "Backbeat on 2 and 4, eighth-note hat.",
      lanes: { kick: "X.......X.x.....", snare: "....X.......X...", hat: "X.x.x.x.X.x.x.x." } },
    { id: "g-rock16", name: "Rock sixteenths", meterId: "4/4", note: "Sixteenth hat with soft in-betweens.",
      lanes: { kick: "X.....x.X.x.....", snare: "....X.......X...", hat: "XgxgXgxgXgxgXgxg" } },
    { id: "g-half", name: "Half-time", meterId: "4/4", note: "Snare on 3 only.",
      lanes: { kick: "X.........X.....", snare: "........X.......", hat: "x.x.x.x.x.x.x.x." } },
    { id: "g-funk", name: "Funk sixteenths", meterId: "4/4", note: "Syncopated kick, ghost notes on snare.",
      lanes: { kick: "X..x..x...X..x..", snare: "....X..g.g..X..g", hat: "xgxgxgxgxgxgxgxg" } },
    { id: "g-four", name: "Four on the floor", meterId: "4/4", note: "Kick every beat, open hat on the offbeats.",
      lanes: { kick: "X...X...X...X...", snare: "....x.......x...", open: "..x...x...x...x.", shaker: "xgxgxgxgxgxgxgxg" } },
    { id: "g-shuffle", name: "Shuffle", meterId: "4/4", swing: 67, note: "Swung eighths (sets swing to triplet).",
      lanes: { kick: "X.......X.x.....", snare: "....X.......X...", hat: "X.x.X.x.X.x.X.x." } },
    { id: "g-bossa", name: "Bossa feel", meterId: "4/4", note: "Kick in pairs, cross-stick pattern, shaker.",
      lanes: { kick: "X..xX..xX..xX..x", snare: "g..g..g...g..g..", shaker: "xgxgxgxgxgxgxgxg" } },
    { id: "g-hand", name: "Shaker and tambourine", meterId: "4/4", note: "Hand percussion only, no kit.",
      lanes: { shaker: "XgxgXgxgXgxgXgxg", tamb: "....X.......X..." } },
    { id: "g-waltz", name: "Waltz", meterId: "3/4", note: "Kick on 1, snare on 2 and 3.",
      lanes: { kick: "X...........", snare: "....x...x...", hat: "x.x.x.x.x.x." } },
    { id: "g-54", name: "Five (3+2)", meterId: "5/4", note: "Kick on 1 and 4, snare on 3 and 5.",
      lanes: { kick: "X...........X.......", snare: "........X.......X...", hat: "x.x.x.x.x.x.x.x.x.x." } },
    { id: "g-68", name: "Six-eight", meterId: "6/8", note: "Two big beats, eighth-note hat.",
      lanes: { kick: "X.........x.", snare: "......X.....", hat: "X.x.x.X.x.x." } },
    { id: "g-78", name: "Seven (2+2+3)", meterId: "7/8a", note: "Kick on the groups, snare on the second.",
      lanes: { kick: "X.......X.....", snare: "....X.....x...", hat: "X.x.X.x.X.x.x." } },
    { id: "g-128", name: "12/8 blues", meterId: "12/8", note: "Slow four, three eighths per beat.",
      lanes: { kick: "X.........x.X...........", snare: "......X...........X.....", hat: "X.x.x.X.x.x.X.x.x.X.x.x." } },
  ];
  const CHANNELS = [
    { id: "click", label: "Click" }, { id: "kick", label: "Kick" }, { id: "snare", label: "Snare" },
    { id: "hat", label: "Hats" }, { id: "shaker", label: "Shaker" }, { id: "tamb", label: "Tamb" },
  ];
  const MIX_DEFAULTS = {
    click: { v: 80, p: 0, m: false }, kick: { v: 80, p: 0, m: false }, snare: { v: 72, p: 0, m: false },
    hat: { v: 58, p: 15, m: false }, shaker: { v: 52, p: -30, m: false }, tamb: { v: 52, p: 30, m: false },
  };
  const defaultMix = () => JSON.parse(JSON.stringify(MIX_DEFAULTS));
  function cleanMix(m) {
    const out = defaultMix();
    if (m && typeof m === "object") for (const ch of CHANNELS) {
      const x = m[ch.id];
      if (!x) continue;
      if (Number.isFinite(x.v)) out[ch.id].v = Math.min(100, Math.max(0, Math.round(x.v)));
      if (Number.isFinite(x.p)) out[ch.id].p = Math.min(50, Math.max(-50, Math.round(x.p)));
      out[ch.id].m = x.m === true;
    }
    return out;
  }
  const DRUM_VOICES = window.POCKET_DRUM_VOICES || [];
  const userGrooves = Array.isArray(stored.userGrooves) ? stored.userGrooves.filter((g) => g && g.id && g.lanes && METERS.some((m) => m.id === g.meterId)) : [];
  const allGrooves = () => STARTER_GROOVES.concat(userGrooves);
  settings.grooveOn = stored.grooveOn === true;
  settings.grooveId = allGrooves().some((g) => g.id === stored.grooveId) ? stored.grooveId : STARTER_GROOVES[0].id;
  settings.grooveLanes = stored.grooveLanes && typeof stored.grooveLanes === "object" ? stored.grooveLanes : null;
  settings.mix = cleanMix(stored.mix);
  settings.kickVoice = KICK_VOICES.some((k) => k.id === stored.kickVoice) && DRUM_VOICES.some((v) => v.id === stored.kickVoice) ? stored.kickVoice
    : DRUM_VOICES.some((v) => v.id === "kickkit") ? "kickkit" : "kick";

  const grooveDef = () => allGrooves().find((g) => g.id === settings.grooveId) || STARTER_GROOVES[0];
  const grooveMeter = (g) => METERS.find((m) => m.id === g.meterId) || METERS[0];
  const grooveStepsPerUnit = (g) => (grooveMeter(g).den <= 4 ? 4 : 2);
  const grooveSteps = (g) => grooveMeter(g).num * grooveStepsPerUnit(g);
  const LEVEL_CHARS = ".gxX";
  /** Lane string → exactly `n` steps (pads with rests, cuts extra). */
  const fitLane = (str, n) => (String(str || "").replace(/[^.gxX]/g, ".") + ".".repeat(n)).slice(0, n);
  function workingLanes() {
    const g = grooveDef(), n = grooveSteps(g), src = settings.grooveLanes || g.lanes;
    return Object.fromEntries(LANES.map((l) => [l.id, fitLane(src[l.id], n)]));
  }
  const grooveEdited = () => !!settings.grooveLanes && JSON.stringify(workingLanes()) !== JSON.stringify(Object.fromEntries(LANES.map((l) => [l.id, fitLane(grooveDef().lanes[l.id], grooveSteps(grooveDef()))])));
  let grooveCache = { key: null, value: null };
  function compiledGroove() {
    const g = grooveDef(), lanes = workingLanes(), key = g.id + JSON.stringify(lanes);
    if (grooveCache.key !== key) {
      const arrays = Object.fromEntries(Object.entries(lanes).map(([id, str]) => [id, [...str].map((c) => LEVEL_CHARS.indexOf(c))]));
      arrays._step = Array(grooveSteps(g)).fill(1); // playhead only, never sounds
      grooveCache = { key, value: { stepsPerUnit: grooveStepsPerUnit(g), lanes: arrays } };
    }
    return grooveCache.value;
  }

  function selectGroove(g) {
    settings.grooveId = g.id;
    settings.grooveLanes = null;
    let changed = false;
    if (g.meterId !== settings.meterId) {
      settings.meterId = g.meterId;
      settings.accents = null;
      changed = true;
    }
    const swing = g.swing || 50;
    if (swing !== settings.swing) { settings.swing = swing; changed = true; }
    if (!settings.grooveOn) settings.grooveOn = true;
    if (changed) { renderTempo(); queueChange("pattern"); renderBeats(); }
    log(`Groove: ${g.name} (${grooveMeter(g).label || grooveMeter(g).id})`);
    if (!isRunning()) previewGroove();
  }

  let grooveCells = [], grooveShown = -1;
  function showGrooveStep(step) {
    if (step === grooveShown) return;
    for (const c of grooveCells[grooveShown] || []) c.classList.remove("now");
    for (const c of grooveCells[step] || []) c.classList.add("now");
    grooveShown = step;
  }
  function clearGrooveStep() { showGrooveStep(-1); eng.grooveVisual = []; }

  function renderGroove() {
    if (!$("groove-panel")) return;
    const on = settings.grooveOn === true;
    const power = $("groove-on");
    power.setAttribute("aria-pressed", String(on));
    power.textContent = on ? "Groove on" : "Groove off";
    $("groove-panel").dataset.on = String(on);
    const g = grooveDef();
    renderChips($("groove-chips"), allGrooves().map((x) => ({ ...x, label: x.name, note: grooveMeter(x).label || grooveMeter(x).id })), (x) => x.id === settings.grooveId, selectGroove);
    const meter = grooveMeter(g);
    const mismatch = meter.id !== settings.meterId;
    $("groove-note").textContent = (g.note || "Your groove.") + (mismatch ? ` Written in ${meter.label || meter.id}; it repeats inside the current bar.` : "");
    $("groove-edited").hidden = !grooveEdited();
    $("groove-revert").disabled = !grooveEdited();
    $("groove-delete").hidden = !userGrooves.some((x) => x.id === g.id);
    $("groove-update").hidden = !userGrooves.some((x) => x.id === g.id);
    $("groove-update").disabled = !grooveEdited();
    renderChips($("kick-voice-chips"), KICK_VOICES.filter((k) => DRUM_VOICES.some((v) => v.id === k.id)), (k) => k.id === settings.kickVoice, (k) => {
      settings.kickVoice = k.id;
      log(`Kick sound: ${k.label}`);
      if (!isRunning()) previewHit("kick", 3);
    });
    renderGrooveGrid();
    renderMixer();
  }

  function renderGrooveGrid() {
    const g = grooveDef(), lanes = workingLanes(), n = grooveSteps(g), per = grooveStepsPerUnit(g);
    const meter = grooveMeter(g);
    const beatEvery = meter.den >= 8 && meter.num % 3 === 0 && meter.num > 3 ? per * 3 : per;
    const grid = $("groove-grid");
    grid.textContent = "";
    grid.style.setProperty("--steps", n);
    grooveCells = Array.from({ length: n }, () => []);
    grooveShown = -1;
    const head = document.createElement("div");
    head.className = "groove-row groove-count";
    head.setAttribute("aria-hidden", "true");
    head.append(document.createElement("span"));
    for (let j = 0; j < n; j++) {
      const s = document.createElement("span");
      s.textContent = j % beatEvery === 0 ? String(j / beatEvery + 1) : j % per === 0 ? "·" : "";
      grooveCells[j].push(s);
      head.append(s);
    }
    grid.append(head);
    for (const lane of LANES) {
      const row = document.createElement("div");
      row.className = "groove-row";
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", lane.label);
      const name = document.createElement("button");
      name.type = "button";
      name.className = "groove-lane";
      name.textContent = lane.label;
      name.setAttribute("aria-label", `Hear ${lane.label}`);
      name.addEventListener("click", () => previewHit(lane.id, 3));
      row.append(name);
      [...lanes[lane.id]].forEach((c, j) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "groove-cell" + (j % beatEvery === 0 ? " g-beat" : j % per === 0 ? " g-unit" : "");
        const lv = LEVEL_CHARS.indexOf(c);
        b.dataset.level = String(lv);
        const where = beatEvery > 1 ? `beat ${Math.floor(j / beatEvery) + 1}, step ${(j % beatEvery) + 1}` : `beat ${j + 1}`;
        b.setAttribute("aria-label", `${lane.label}, ${where}: ${["rest", "ghost", "hit", "accent"][lv]}`);
        b.addEventListener("click", () => cycleCell(lane.id, j));
        grooveCells[j].push(b);
        row.append(b);
      });
      grid.append(row);
    }
  }
  /** Tap a step: rest → hit → accent → ghost → rest. Plays from the next scheduled step. */
  function cycleCell(laneId, j) {
    const lanes = workingLanes();
    const order = ".xXg";
    const next = order[(order.indexOf(lanes[laneId][j]) + 1) % order.length];
    lanes[laneId] = lanes[laneId].slice(0, j) + next + lanes[laneId].slice(j + 1);
    settings.grooveLanes = lanes;
    if (next !== "." && !isRunning()) previewHit(laneId, LEVEL_CHARS.indexOf(next));
    saveStore();
    renderGroove();
  }

  let previewDrums = [];
  async function previewHit(lane, level) {
    if (isRunning()) return;
    try {
      ensureAudio();
      if (eng.ctx.state !== "running") await eng.ctx.resume();
      playDrum(lane, level, eng.ctx.currentTime + 0.03);
    } catch (e) { log(`Preview failed: ${e.message}`, "warn"); }
  }
  /** One bar of the groove at the current tempo, without the click. */
  async function previewGroove() {
    try {
      ensureAudio();
      if (eng.ctx.state !== "running") await eng.ctx.resume();
      if (isRunning()) return;
      for (const s of previewDrums) { try { s.stop(); } catch { /* done */ } }
      const t0 = eng.ctx.currentTime + 0.05;
      const plan = T.PlaybackPlan.click({ pattern: currentPattern(), tempo: currentTempo(), startTime: t0 });
      const end = plan.startTimeOfBar(1);
      const before = new Set(eng.sources);
      for (const h of plan.grooveEventsIn(t0, end, compiledGroove())) if (h.lane !== "_step") playDrum(h.lane, h.level, h.time);
      previewDrums = [...eng.sources].filter((s) => !before.has(s));
    } catch (e) { log(`Preview failed: ${e.message}`, "warn"); }
  }

  function renderMixer() {
    const el = $("mixer");
    if (el.dataset.built !== "1") {
      el.textContent = "";
      for (const ch of CHANNELS) {
        const strip = document.createElement("div");
        strip.className = "strip";
        strip.dataset.ch = ch.id;
        strip.innerHTML = `<span class="strip-name"></span>
          <button type="button" class="cc-toggle strip-mute" aria-pressed="false">Mute</button>
          <label class="strip-row"><span class="cc-label">Vol</span><input type="range" min="0" max="100" step="1" class="strip-vol"><output class="strip-out"></output></label>
          <label class="strip-row"><span class="cc-label">Pan</span><input type="range" min="-50" max="50" step="5" class="strip-pan"><output class="strip-pan-out"></output></label>`;
        strip.querySelector(".strip-name").textContent = ch.label;
        strip.querySelector(".strip-mute").setAttribute("aria-label", `Mute ${ch.label}`);
        strip.querySelector(".strip-vol").setAttribute("aria-label", `${ch.label} volume`);
        strip.querySelector(".strip-pan").setAttribute("aria-label", `${ch.label} pan`);
        const update = (patch) => {
          settings.mix = { ...settings.mix, [ch.id]: { ...settings.mix[ch.id], ...patch } };
          applyMix();
          renderMixer();
          saveStore();
        };
        strip.querySelector(".strip-mute").addEventListener("click", () => update({ m: !settings.mix[ch.id].m }));
        strip.querySelector(".strip-vol").addEventListener("input", (e) => update({ v: Number(e.target.value) }));
        strip.querySelector(".strip-pan").addEventListener("input", (e) => update({ p: Number(e.target.value) }));
        strip.querySelector(".strip-pan").addEventListener("dblclick", () => update({ p: 0 }));
        el.append(strip);
      }
      el.dataset.built = "1";
    }
    for (const strip of el.children) {
      const m = settings.mix[strip.dataset.ch];
      strip.dataset.muted = String(m.m);
      strip.querySelector(".strip-mute").setAttribute("aria-pressed", String(m.m));
      const vol = strip.querySelector(".strip-vol"), pan = strip.querySelector(".strip-pan");
      if (Number(vol.value) !== m.v) vol.value = String(m.v);
      if (Number(pan.value) !== m.p) pan.value = String(m.p);
      strip.querySelector(".strip-out").textContent = String(m.v);
      strip.querySelector(".strip-pan-out").textContent = m.p === 0 ? "C" : m.p < 0 ? `L${-m.p * 2}` : `R${m.p * 2}`;
      pan.setAttribute("aria-valuetext", m.p === 0 ? "Centre" : `${Math.abs(m.p * 2)}% ${m.p < 0 ? "left" : "right"}`);
      vol.setAttribute("aria-valuetext", m.m ? `${m.v}, muted` : String(m.v));
    }
  }

  $("groove-on").addEventListener("click", () => {
    settings.grooveOn = !settings.grooveOn;
    log(`Groove ${settings.grooveOn ? "on" : "off"}: ${grooveDef().name}`);
    if (!settings.grooveOn) clearGrooveStep();
    renderSetup();
    saveStore();
  });
  $("groove-preview").addEventListener("click", () => { if (!isRunning()) previewGroove(); });
  $("groove-clear").addEventListener("click", () => {
    const n = grooveSteps(grooveDef());
    settings.grooveLanes = Object.fromEntries(LANES.map((l) => [l.id, ".".repeat(n)]));
    saveStore(); renderGroove();
  });
  $("groove-revert").addEventListener("click", () => { settings.grooveLanes = null; saveStore(); renderGroove(); });
  $("groove-update").addEventListener("click", () => {
    const g = userGrooves.find((x) => x.id === settings.grooveId);
    if (!g) return;
    g.lanes = workingLanes();
    settings.grooveLanes = null;
    log(`Groove updated: ${g.name}`);
    saveStore(); renderGroove();
  });
  $("groove-delete").addEventListener("click", () => {
    const i = userGrooves.findIndex((x) => x.id === settings.grooveId);
    if (i < 0) return;
    const [g] = userGrooves.splice(i, 1);
    settings.grooveId = STARTER_GROOVES[0].id;
    settings.grooveLanes = null;
    log(`Groove deleted: ${g.name}`);
    saveStore(); renderGroove();
  });
  $("groove-save").addEventListener("click", () => {
    $("groove-name-form").hidden = false;
    $("groove-save").hidden = true;
    const input = $("groove-name");
    input.value = grooveEdited() ? `${grooveDef().name} (mine)` : `My groove ${userGrooves.length + 1}`;
    input.focus(); input.select();
  });
  $("groove-name-cancel").addEventListener("click", () => { $("groove-name-form").hidden = true; $("groove-save").hidden = false; });
  $("groove-name-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("groove-name").value.trim().slice(0, 40);
    if (!name) return;
    const base = grooveDef();
    const g = { id: `ug-${Date.now().toString(36)}`, name, meterId: base.meterId, note: "Your groove.", lanes: workingLanes() };
    if (base.swing) g.swing = base.swing;
    userGrooves.push(g);
    settings.grooveId = g.id;
    settings.grooveLanes = null;
    $("groove-name-form").hidden = true;
    $("groove-save").hidden = false;
    log(`Groove saved: ${name}`);
    saveStore(); renderGroove();
  });
  $("mixer-reset").addEventListener("click", () => { settings.mix = defaultMix(); applyMix(); renderMixer(); saveStore(); });
  $("rail-groove").addEventListener("click", () => $("groove-panel").scrollIntoView({ behavior: "smooth", block: "start" }));

  // ---------- boot ----------
  buildDial();
  applyConcept();
  applyLayout();
  setWorkspace(settings.workspace);
  renderTempo();
  renderBeats();
  renderSetup();
  renderChecks();
  renderPresets();
  renderGap();
  renderMetrics();
  renderAwake();
  updateAwake();
  setInterval(renderMetrics, 500);
  requestAnimationFrame(frame);
  log(`Loaded ${IS_PWA ? "home-screen build" : "preview"} in ${BROWSER.label}. Press Start to enable audio.`);
})();
