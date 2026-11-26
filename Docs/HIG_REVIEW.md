# Apple HIG review (2026-11-26)

Checked the web test against Apple's Human Interface Guidelines pages for
buttons, sheets, steppers, pickers, playing audio, accessibility, segmented
controls, toggles and feedback (developer.apple.com/design/human-interface-guidelines).
Sizes and contrast were measured in all four looks at iPad size.

| Guideline | Finding | Outcome |
|---|---|---|
| Touch targets ≥ 44 pt | Click/Practice switch was 38 px tall; checkboxes are 22 px but sit inside 44 px-tall labels that are tappable | Switch raised to 44 px; checkboxes left as is (label is the target) |
| Contrast (WCAG AA 4.5:1 small text) | Measured pairs pass (6.1–11.8:1) except D's small grey notes on tan keys at 3.35:1 | D notes now full-strength ink (6.1:1) |
| Pickers: show in context, near the field | Tempo pad already opens under the number | Practice fields now use the same pad, anchored to the field |
| Steppers: pair with a field for big changes; a modifier for larger steps | ±1/±5 plus the pad; no keyboard shortcut | ↑/↓ change tempo by 1, Shift by 5 (hardware keyboard) |
| Playing audio: unplugging headphones should pause; decide whether to resume after interruptions | POCKET stopped on output change, calls, background loss | Now **pauses** (keeps bar and practice stage), shows why, never resumes on its own; Resume continues |
| Playing audio: silent switch / category | Silent-mode playback is a user setting (on by default) | Kept; documented trade-off with other apps' music |
| Playing audio: vary repetitive sounds | Recorded kits rotate takes where available | Kept; no random pitch drift (a metronome should be consistent) |
| Sheets: one at a time; Cancel leading, Done trailing; non-modal allowed on iPad | Settings is a non-modal sheet with Done (settings apply live, nothing to cancel); keypad has Cancel left, Set right | Kept; Presets opened from Settings closes Settings first (one sheet at a time) |
| Feedback: confirm significant actions; warn before unexpected data loss | Saving was only logged; deletes needed two taps | "Saved …" / "Session saved" confirmations; two-tap delete kept |
| Segmented controls ≤ 5–7 segments | Settings tabs 5, workspace switch 2; meter list (9) is a grid of choices, not a segmented control | Kept |
| Accessibility: VoiceOver labels, Reduce Motion, larger text | Labels on icon-only keys; Reduce Motion handled; text sizes in px | Kept; **to do:** check iPad text-size settings on device |
