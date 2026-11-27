# UX: Quick Click

Flows, states and copy for the Quick Click workspace (plan §03, §05). The
content is platform-neutral: it applies to the web build and a native build
alike. Visual design (colour, type, layout) is out of scope until the platform
decision (D-008) and the three-concept comparison.

Status: v0.2, 2026-11-25. Owner decisions O-1 to O-4 are recorded at the end.

## Principles

1. **One tap to sound.** From launch, Start is the only action needed.
2. **Nothing changes mid-bar by surprise.** A change you make while playing lands
   on a clean boundary, and the screen tells you when.
3. **Nothing starts by itself.** After any stop the app didn't ask for, sound only
   comes back when you press Start.
4. **Stop always works.** Stop is always visible and always silences within
   100 ms (plan §10).
5. **Say what happened in musician's words.** No error codes, no "audio context".

## States

| State | What you see | Start button | What you can do |
|---|---|---|---|
| **Ready** | Tempo, meter, beats; no beat lit | Start | Everything |
| **Count-in** | "Count-in 1 … 4", beats light in blue, distinct sound | Stop (Pause beside it) | Stop, Pause; change settings |
| **Playing** | Beat dot lights on each beat; bar number and time | Stop (Pause beside it) | Change tempo, meter, subdivision, accents, sound, volume |
| **Change waiting** (while playing) | Note under the tempo: "Next beat: 117 BPM" (or "Next bar: …") | Stop | Keep changing; the latest value wins |
| **Paused** | Status "Paused"; bar number and time held | Resume (Stop beside it) | Resume, Stop, change settings |
| **Stopped by the system** | Message bar above the tempo; status "Stopped" | Start | Read the message, dismiss it, or press Start |
| **Can't start** | Message bar; status "Ready" | Start | Fix the cause, press Start again |

Transitions follow the plan's transport contract (§06): Ready → Count-in →
Playing ↔ Paused → Ready. "Stopped by the system" is reached from Count-in or Playing and
leaves only by Start or Dismiss. A failed start returns to Ready with a reason.

## Journeys

### J1 · Launch to sound
1. Open POCKET. It shows the last setup you used: tempo, meter, grouping,
   subdivision, accents, sound, volume, count-in.
2. Press Start. The count-in plays (if set), then the click.

- No setup screen, no modal, no prompt. On the web, the first tap also unlocks
  audio; it must not need a second tap.
- First click within ~120 ms of Start (plus the count-in).
- First launch ever: 120 BPM, 4/4, no subdivision, 1-bar count-in, Wood, 60%
  volume (see O-2).

### J2 · Set an exact tempo
1. Tap the tempo number. POCKET's own number pad opens under it (iPadOS has no
   number-only keyboard for web pages): 0–9, decimal point, delete, Cancel, Set.
   The current tempo shows dimmed; the first key replaces it.
2. Type the tempo and tap **Set**. Tapping outside or Cancel keeps the old tempo.
   A hardware keyboard works too (digits, ".", Backspace, Enter, Escape).
- The pad sits above the transport, so Start/Stop stay reachable.

- Accepts 20–300, with up to two decimals (112.5).
- Out of range: keep the pad open and show "Enter a tempo from 20 to 300."
- Escape (hardware keyboard) cancels and keeps the old tempo.
- Target: set an exact tempo and start within 10 seconds (plan §10 usability gate).

### J3 · Change tempo while playing
- **Where it lands:** **immediately**, on the next click not yet scheduled
  (within about 150 ms), by default (owner, 2026-11-26). Settings → "Tempo
  changes land on" offers **Next beat** and **Next bar**. A beat follows the tempo's beat unit (a
  dotted quarter in 6/8, an eighth in 7/8).
- **−5 / −1 / +1 / +5:** the big number updates at once. A note shows
  "Next beat: 117 BPM" until the change lands, then "Now 117 BPM" for one bar.
- **Several taps before the boundary** combine into one change; the click never
  steps through the intermediate tempos.
- **Hold ±1** to repeat: starts after 400 ms, then 8 steps a second, stops the
  moment your finger lifts or slides off. Each step is a normal tap (no
  acceleration), so it can't run away.
- **Tap tempo:** two taps set a tempo; it averages up to the last four gaps and
  restarts after a 2-second pause. Taps make no sound. While playing, the result
  applies at the next beat (or bar) like any other change. Feedback: "Tap again"
  after the first tap, then the live value.

### J4 · Change the pattern while playing
**Accents** (tapping a beat) apply **immediately**: the beat row changes as you
tap and the next click uses it, even mid-bar, because the bar's grid doesn't
change. **Meter, grouping and subdivision** apply **at the next bar line**, with
the preview row below. If you change tempo and meter together, both land on
the bar line.

- The beat row keeps following what you hear until the switch. The new pattern
  shows as a preview row tagged "Next bar · 3/4", then takes over on the
  downbeat. While the preview shows, taps edit the preview (what you'll hear
  next); the row you're hearing can't be edited.
- Changing meter resets accents to that meter's default; changing subdivision
  keeps accents.
- Tapping a beat cycles strong → group → normal → silent. A silent beat keeps
  its place in the bar (the clock never pauses).

### J5 · Stop, pause and resume
- **Stop** silences at once and cancels anything already scheduled. No trailing
  click. Settings stay as they were; the next Start begins again at bar 1.
- **Pause** also silences at once, but keeps your place: bar count and elapsed
  time hold. The main button becomes **Resume**, with **Stop** beside it.
- **Resume** continues from the next bar number. It counts in only when
  Count-in is set to "Every start".
- An interruption while paused changes nothing; nothing starts until you press Resume.
- Keep screen awake treats Paused like playing.

### J6 · Count-in
- **When:** Settings → Count-in: **Every start** (including Resume, default),
  **First start only** (the first Start after opening POCKET), or **Off**.
  Length: 1 or 2 bars.
- Uses the music's tempo, sounds every beat (even beats you've silenced), no
  subdivisions, and a different sound so it's never mistaken for bar 1.
- The position readout says "Count-in 1 … 4", then "Bar 1".
- Stop during the count-in returns to Ready.

### J7 · Silent mode
- The click plays even when the iPad is on silent. Setting: "Play even when the
  iPad is on silent" (on by default), with the note "May pause music playing in
  another app."
- Turning it off lets silent mode mute the click, and lets other apps' music
  carry on. It applies from the next Start.

### J9 · Presets
- The side panel shows the current preset's name, with "· edited" once you change
  anything. **Presets** opens the list (also in Settings › Click for the Stage look).
- Tap a preset to load it. While playing, tempo and accents change at once; a new
  meter or subdivision waits for the bar line, as usual.
- **Save as new** (name suggested, e.g. "125 BPM 4/4") and **Update "name"** are
  separate buttons, so nothing is overwritten by accident (plan §05).
- **Edit** shows Rename and Delete; Delete needs a second tap.
- A preset holds tempo, meter and grouping, accents, subdivision, sound and
  count-in. Starter presets: Quick Click, Double pedal eighths, 7/8 (2+2+3) groove.

### J8 · Settings
- The main screen holds only what you touch while playing: tempo, ±/TAP, the
  beat row, meter, subdivision and volume. (Stage look: tempo, ±/TAP and beats only.)
- **Settings** (top right) opens a sheet with four tabs:
  - **Click:** meter, subdivision, count-in (when and how long), where tempo
    changes land, sound.
  - **Look:** design concepts A–D.
  - **iPad:** keep screen awake, play in silent mode, stop when the output changes.
  - **Test:** counters, checklist, notes, event log, Copy report.
- The sheet stops above the transport, so Start/Stop/Pause keep working while
  it's open; the click keeps playing and changes queue as usual.
- Done, Esc or tapping outside closes it; focus returns to the Settings button.
  It reopens on the last tab used.

## Messages

Every message says what happened, what POCKET did, and what to do, in under
about 25 words. No apologies, no "error", no technical terms. Exactly one action.

Placement: a bar above the tempo that never covers Start/Stop. It stays until
you dismiss it or press Start. Screen readers announce it once (alert role).

| Case | Trigger | POCKET does | Message |
|---|---|---|---|
| **Audio taken over** | A call, Siri, an alarm or another app takes the audio | Pauses (keeps your place); won't resume | **Click paused.** A call or another app took over the sound. Press Resume when you're ready. |
| **Output changed** | Headphones unplugged, Bluetooth disconnected or switched | Pauses (setting, on by default) | **Click paused because the sound output changed.** Check where it will play, then press Resume. |
| **Stopped in the background** | You left POCKET and the system stopped the sound | Pauses; shows on return | **Click paused while POCKET was in the background.** Press Resume to continue. |
| **Fell behind in the background** | Sound kept going but clicks were skipped while away | Pauses on return | **Click paused: POCKET skipped 6 clicks while in the background.** Press Resume to continue. |
| **Can't start** | Audio won't start | Returns to Ready | **No sound yet.** Check the volume and that the iPad isn't muted, then press Start. |
| **Timing hiccup** | Clicks skipped while on screen | Keeps playing; counts it | **Timing hiccup: 2 clicks were skipped.** Close other apps if it happens again. *(non-blocking, fades after 5 s)* |
| **Screen may lock** | Keep-awake isn't possible | Keeps playing | The screen may lock on its usual timer. *(status text, not a message bar)* |
| **Couldn't save** | Storage write fails | Keeps working | **Couldn't save this change.** Your setup works until you close POCKET. |

System interruptions **pause** rather than stop (Apple HIG › Playing audio:
unplugging headphones pauses playback), so your bar count and practice stage are
kept; nothing ever resumes without you. Why pause on return after skipped clicks (instead of carrying on): a click that
skipped while you weren't looking has already broken your time. Making you press
Start is the honest way to say so (principle 3).

## Accessibility

- Every control has a spoken label: "Faster by 5", "Beat 3: group accent. Double-tap to change."
- Tempo changes are announced once ("117 BPM, from next bar"); beats are not announced.
- Space toggles Start/Stop on a hardware keyboard.
- Reduce Motion: beats light without scaling or flashing.
- State never relies on colour alone: the count-in has its own label and sound, and
  silent beats have a dashed outline.

## Web test vs this spec

Already matches: states, next-bar changes, combined taps, count-in, Stop, the
output-change setting, message placement, keyboard Start.

| Gap | Status |
|---|---|
| Message copy | Updated to the table above |
| Next-beat tempo changes with a Next bar setting | Added |
| Pause / Resume | Added |
| Count-in: Every start / First start only / Off | Added |
| Stop on return after the system stopped audio or clicks were skipped in the background | Added |
| "Tap again" / "Now 117 BPM" feedback | Added |
| Beat row previews the next pattern instead of switching early | Added |
| Hold ±1 to repeat | Added |
| Non-blocking "timing hiccup" notice | Added |

## Owner decisions (2026-11-25)

- **O-1 · Tempo changes land on the next beat**, with a setting for next bar.
  *Revised 2026-11-26:* tempo changes and accent taps land **immediately** by
  default; Next beat and Next bar stay as options; meter/subdivision on the bar line.
- **O-2 · First launch:** 120 BPM, 4/4, 1-bar count-in. Fine for now.
- **O-3 · Quick Click has Pause** (J5).
- **O-4 · Count-in setting:** Every start / First start only / Off, plus length (J6).

# UX: Practice · interval ladder (M2, first routine)

Plan §07: "130 BPM eighth notes, 30 s playing / 15 s recovery, +5 BPM per stage,
up to a user-selected cap. Show the next tempo, not a pressure-inducing score.
Allow repeating or stepping down. Log clean working tempo, perceived effort
(1–5), technique notes and whether the stage completed."

## Flow
1. **Practice** (top bar, or the rail on wide screens). The switch is locked
   while playing or paused.
2. **Set up:** start tempo, step, top tempo, play seconds, rest seconds,
   subdivision. A preview line shows the stages and the total time, e.g.
   "7 stages: 130 → … → 160 BPM · about 5 min". Meter, accents and sound come
   from Click. Values are remembered on this device.
3. **Start ladder:** one bar of count-in, then stage 1.
4. **While playing:** a phase badge (Play / Rest / Count-in), the stage tempo,
   time left, "Stage 2 of 7 · Next: 140 BPM". In a rest the big number is the
   tempo coming up.
   - **Repeat this stage** and **Step down** (only during Play) change what comes
     after this stage. Step down goes one step lower and climbs again. The note
     says what will happen ("Repeating 140 BPM next").
   - **During each rest:** "How did 140 feel?" 1 (easy) to 5 (hard), and "It was
     clean". Both optional.
   - **Pause** keeps your place; **Resume** restarts the current stage with a count-in.
5. **End:** the ladder ends after the top stage, or when you press Stop. The
   summary lists each stage started (tempo, done or stopped, effort, clean),
   proposes a clean working tempo (the highest stage marked clean, else the
   highest completed), and takes technique notes. **Save session** or
   **Discard** (tap twice).
6. **Recent sessions** shows the last 10 saved: date, clean tempo, range,
   stages done, average effort, notes.

## Timing rules
- Each stage and rest is rounded to whole bars, so every stage starts on a
  downbeat. Displayed times reflect the rounded length.
- A rest is silent bars plus one bar of count-in at the *next* tempo (count-in
  sound, always distinguishable).
- The whole ladder is one timing plan; changes rebuild it from the next rest
  without moving any earlier click.
- No automatic progression based on speed: the ladder stops at your top tempo.

### J10 · Gap click (plan §07)
- **Main screen:** Gap click **Off / Bars / Random** with a one-line summary
  ("Play 2 bars, then 2 silent", "About 30% of bars silent · pattern #4821").
- **Settings › Click › Gap click:** bars that play and silent bars (1–16, number
  pad); chance of a silent bar (10–50%); **New pattern**; "Beat lights go dark
  during silent bars" (on by default).
- **Random rules:** never in the first 2 bars, never more than 2 silent bars in a
  row; the same pattern number always gives the same gaps (reproducible sessions).
- During a silent bar nothing sounds, the clock keeps running, the lights go dark
  (if set) and a calm "Silent bar · keep going" label shows. The count-in always plays.
- Changing gap settings while playing applies immediately without moving any click.
- Presets remember gap settings; presets saved earlier load with gaps off.
- Applies in Practice too (silent bars inside a ladder's play stages).

## Practice · routine library (2026-11-26)

The interval ladder became one of several **routines**. Each routine has a kind,
its own meter, accents, subdivision and gap click, and play/rest times.

| Starter routine (plan §07) | Kind | Settings |
|---|---|---|
| Double-pedal control | Tempo ladder | 130→160 by 5, ÷2, 30 s / 15 s |
| Rudiments with gap click | Tempo ladder | 90→130 by 10, ÷4, 45 s / 15 s, random gaps 25% |
| Four-mallet subdivisions | Subdivisions | 72 BPM; ÷2, ÷3, ÷4, ÷6 in turn; 40 s / 15 s |
| Independence, quiet backbeat | Tempo ladder | 80→110 by 10, click only on 2 and 4, 60 s / 15 s |
| Excerpt tempo ladder | Tempo ladder | 96→132 by 6, 45 s / 20 s; set Top to the target tempo |

- **Setup:** pick a routine (cards show a summary and a note); adjust its values
  (number pad), subdivision (ladder) or the subdivisions to cycle (tap to add or
  remove), meter, and gap click (Off, Random 15/25/40%, Bars 3+1, Bars 2+2). The
  preview lists every stage and the total time. "· edited" shows unsaved changes.
- **Library actions:** Update, Save as new, Rename, Delete (two taps). Earlier
  single-ladder settings carry over into Double-pedal control.
- **While playing:** the stage shows tempo and subdivision ("120 ÷3 · Quarter +
  Triplet"). **Step down** on a tempo ladder drops one step and climbs again; on a
  subdivision routine it plays the remaining subdivisions one step slower.
- **Summary and history** name the routine and show each stage's tempo and
  subdivision.
- The main button reads **Start routine** in Practice.

### J11 · Swing (plan §07)
- With ÷2 (eighths) or ÷4 (sixteenths), a **Swing** row appears under Subdivision:
  **Straight · Light 55% · Medium 60% · Triplet 67% · Heavy 72%**.
- Swing moves only the second note of each pair later; every beat (and every
  first note of a pair) stays exact, and notes can never cross.
- Other subdivisions (triplets, quintuplets…) play straight; Settings › Click
  shows the choices greyed out with "Swing works with ÷2 (eighths) and ÷4
  (sixteenths)".
- Changes apply immediately while playing. Presets remember swing; the console
  display shows "swing 60%".
