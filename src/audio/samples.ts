import { SoundCue } from "./cues";
import deliveryUrl from "./samples/delivery.ogg?url";
import bounceUrl from "./samples/bounce.ogg?url";
import cashUrl from "./samples/cash.ogg?url";
import switchUrl from "./samples/switch.ogg?url";
import signalUrl from "./samples/signal.ogg?url";

// THE SAMPLE MANIFEST — which bundled file each cue plays, and how loud.
//
// Every file is CC0 (public domain) from Kenney.nl, so the game stays free to
// license commercially with no attribution obligation. Provenance for each one
// — pack, original filename, licence, download date — is recorded in
// `docs/ASSETS.md`; the files here are renamed to their ROLE, so that document
// is the only place the chain of custody lives. Keep it in step when you swap
// a sound.
//
// They were chosen by MEASUREMENT rather than by filename (decoded through the
// same Web Audio path the game uses, then compared on duration, attack, band
// energies and pitch movement) — the reason for each pick is on its line.
//
// Imported with `?url` rather than read from `public/`: Vite then fingerprints
// and base-path-rewrites them, so they keep working under the GitHub Pages
// preview prefix without anything here knowing about deploy paths.

export interface SampleSpec {
  url: string;
  // Playback gain. The pack is mastered near full scale, so these are RELATIVE
  // levels between cues (what should sit forward, what should stay incidental),
  // not a normalisation.
  gain: number;
}

export const SAMPLES: Record<SoundCue, SampleSpec> = {
  // Kenney interface `confirmation_001`: 196Hz → 393Hz, a clean octave UP.
  // A rising interval is what reads as success; the flat and falling
  // candidates read as an acknowledgement, or as an error.
  delivery: { url: deliveryUrl, gain: 0.55 },
  // Kenney impact `impactWood_heavy_002`: 97% of its energy below 300Hz with
  // almost no zero-crossings — the dullest, heaviest knock in the pack. The
  // name says wood; the spectrum says "something big hit something solid",
  // which is what a train refusing the wrong depot should sound like.
  bounce: { url: bounceUrl, gain: 0.7 },
  // Kenney casino `chips-stack-1`: 59% of its energy above 4kHz and rising —
  // the bright chatter of coins landing on coins.
  cash: { url: cashUrl, gain: 0.5 },
  // Kenney impact `impactMetal_light_000`: 1.6ms attack (no wind-up at all)
  // and energy spread across body AND metal (46/25/25) — a lever thrown, not
  // a toggle nudged. The `switchNN` files all had a 90-170ms wind-up, which
  // reads as a plastic rocker switch.
  switch: { url: switchUrl, gain: 0.45 },
  // Kenney interface `tick_001`: 45ms end to end, 0.6ms attack. A relay, and
  // short enough that cycling a signal quickly never smears.
  signal: { url: signalUrl, gain: 0.4 },
};
