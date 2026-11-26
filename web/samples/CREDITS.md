# Sample credits

The recorded kits are processed from the **Versilian Community Sample Library
(VCSL)** by Versilian Studios, https://github.com/sgossner/VCSL, released under
**CC0 1.0 Universal** (public domain). Attribution is not required; it is given
with thanks.

| Kit | VCSL source folder | Files used |
|---|---|---|
| Wood block | Idiophones/Struck Idiophones/Woodblock | wood_click_ff, _f_rr1/2, _mp, wood_click2_mp, _pp_rr1–3 |
| Claves | Idiophones/Struck Idiophones/Claves | Claves1_Hit_v1–v3 |
| Rim click | Membranophones/Struck Membranophones/Legacy Snares/drum1 | snare1_click, _click2–4 |
| Cowbell | Idiophones/Struck Idiophones/Cowbells | Cowbell1_Hit_v2–v4, Cowbell1_Muted_v2–v3 |
| Agogo | Idiophones/Struck Idiophones/Agogo Bells | Agogo_High_v2–v3, Agogo_Low_v1–v2 |
| Log drum | Idiophones/Struck Idiophones/Slit Drum | LogDrumHi_MedM_v2–v3, LogDrumLo_MedM_v1–v2 |
| Hi-hat | Idiophones/Struck Idiophones/Hi-Hat Cymbal | HiHat_HitC_v1–v4 (rr1, rr2) |

Processing (`web/tools/build-samples.mjs`): mixed to mono, DC removed, trimmed so
the attack starts within 0.5 ms of the file start, tail cut below −60 dB (or at
the kit's maximum length) with a 15 ms fade, loudness-matched, saved as 16-bit WAV.
The exact file-to-level mapping is in `manifest.json` and `kits.json`.

To rebuild from a fresh copy of VCSL: put the source files in
`<raw>/<kit dir>/` as listed in `manifest.json`, then run
`node web/tools/build-samples.mjs <raw>`.
