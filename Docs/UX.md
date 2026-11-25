# UX: Quick Click

Flows, states and copy for the Quick Click workspace (plan §03, §05). The
content is platform-neutral: it applies to the web build and a native build
alike. Visual design (colour, type, layout) is out of scope until the platform
decision (D-008) and the three-concept comparison.

Status: draft v0.1, 2026-11-25. Open questions for the owner are at the end.

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
| **Count-in** | "Count-in 1 … 4", beats light in blue, distinct sound | Stop | Stop; change settings (applies when the music starts) |
| **Playing** | Beat dot lights on each beat; bar number and time | Stop | Change tempo, meter, subdivision, accents, sound, volume |
| **Change waiting** (while playing) | Note under the tempo: "Next bar: 117 BPM" | Stop | Keep changing; the latest value wins |
| **Stopped by the system** | Message bar above the tempo; status "Stopped" | Start | Read the message, dismiss it, or press Start |
| **Can't start** | Message bar; status "Ready" | Start | Fix the cause, press Start again |

Transitions follow the plan's transport contract (§06): Ready → Count-in →
Playing → Ready. "Stopped by the system" is reached from Count-in or Playing and
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
1. Tap the tempo number. It becomes a field with the number keypad, value selected.
2. Type the tempo and press Done (or tap outside).

- Accepts 20–300, with up to two decimals (112.5).
- Out of range: keep the field open and show "Enter a tempo from 20 to 300."
- Escape (hardware keyboard) cancels and keeps the old tempo.
- Target: set an exact tempo and start within 10 seconds (plan §10 usability gate).

### J3 · Change tempo while playing
- **−5 / −1 / +1 / +5:** the big number updates at once. A note shows
  "Next bar: 117 BPM" until the change lands, then "Now 117 BPM" for one bar.
- **Several taps before the bar line** combine into one change; the click never
  steps through the intermediate tempos.
- **Hold ±1** to repeat: starts after 400 ms, then 8 steps a second, stops the
  moment your finger lifts or slides off. Each step is a normal tap (no
  acceleration), so it can't run away.
- **Tap tempo:** two taps set a tempo; it averages up to the last four gaps and
  restarts after a 2-second pause. Taps make no sound. While playing, the result
  applies at the next bar like any other change. Feedback: "Tap again" after the
  first tap, then the live value.
- Where the change lands, bar or beat, is open question O-1.

### J4 · Change the pattern while playing
Meter, grouping, subdivision and accents all apply **at the next bar line**.

- The beat row keeps following what you hear until the switch. The new pattern
  shows as a preview with a "Next bar" tag, then takes over on the downbeat.
- Changing meter resets accents to that meter's default; changing subdivision
  keeps accents.
- Tapping a beat cycles strong → group → normal → silent. A silent beat keeps
  its place in the bar (the clock never pauses).

### J5 · Stop and start again
- Stop silences at once and cancels anything already scheduled. No trailing click.
- Settings stay exactly as they were. Start plays again from the count-in.
- Quick Click has no Pause. Pausing belongs to Practice, where a routine has a
  position worth keeping (see O-3).

### J6 · Count-in
- Uses the music's tempo, sounds every beat (even beats you've silenced), no
  subdivisions, and a different sound so it's never mistaken for bar 1.
- The position readout says "Count-in 1 … 4", then "Bar 1".
- Stop during the count-in returns to Ready.

## Messages

Every message says what happened, what POCKET did, and what to do, in under
about 25 words. No apologies, no "error", no technical terms. Exactly one action.

Placement: a bar above the tempo that never covers Start/Stop. It stays until
you dismiss it or press Start. Screen readers announce it once (alert role).

| Case | Trigger | POCKET does | Message |
|---|---|---|---|
| **Audio taken over** | A call, Siri, an alarm or another app takes the audio | Stops; won't resume | **Click stopped.** A call or another app took over the sound. Press Start when you're ready. |
| **Output changed** | Headphones unplugged, Bluetooth disconnected or switched | Stops (setting, on by default) | **Click stopped because the sound output changed.** Check where it will play, then press Start. |
| **Stopped in the background** | You left POCKET and the system stopped the sound | Stops; shows on return | **Click stopped while POCKET was in the background.** Press Start to play again. |
| **Fell behind in the background** | Sound kept going but clicks were skipped while away | Stops on return | **Click stopped: POCKET skipped 6 clicks while in the background.** Press Start to play again. |
| **Can't start** | Audio won't start | Returns to Ready | **No sound yet.** Check the volume and that the iPad isn't muted, then press Start. |
| **Timing hiccup** | Clicks skipped while on screen | Keeps playing; counts it | **Timing hiccup: 2 clicks were skipped.** Close other apps if it happens again. *(non-blocking, fades after 5 s)* |
| **Screen may lock** | Keep-awake isn't possible | Keeps playing | The screen may lock on its usual timer. *(status text, not a message bar)* |
| **Couldn't save** | Storage write fails | Keeps working | **Couldn't save this change.** Your setup works until you close POCKET. |

Why stop on return after skipped clicks (instead of carrying on): a click that
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
| Stop on return after the system stopped audio or clicks were skipped in the background | Added |
| "Tap again" / "Now 117 BPM" feedback | Added |
| Beat row previews the next pattern instead of switching early | Not yet |
| Hold ±1 to repeat | Not yet |
| Non-blocking "timing hiccup" notice | Not yet (counted in diagnostics) |

## Open questions for the owner

- **O-1 · Where should a tempo change land: next bar or next beat?** The plan's
  journey says "next beat"; the engine currently uses the next bar. Next beat feels
  more immediate when nudging; next bar never splits a bar between two tempos.
  *Suggestion:* tempo on the next beat, pattern changes on the next bar.
- **O-2 · First-launch setup.** 120 BPM 4/4 with a 1-bar count-in, or your own usual start?
- **O-3 · Pause in Quick Click?** Spec says no (Stop only). Is there a case where you'd want it?
- **O-4 · Count-in on every Start, or only the first after opening?**
