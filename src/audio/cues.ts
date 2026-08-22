import { SimEvent } from "@/sim/simulation";

// The game's sound vocabulary. Each cue is played from a small bundled CC0
// sample (see samples.ts), falling back to a synthesised gesture (synth.ts)
// when a sample has not loaded. The names are the contract between the event
// stream and the engine — the mapping below and the click handlers in the
// views speak in these, and neither has to know which backend made the noise.
export type SoundCue =
  // A train parked on a colour match — the win chime.
  | "delivery"
  // A mismatched arrival: the train thuds off the wrong depot.
  | "bounce"
  // A fare was banked (Tycoon): the register tick, played on top of the chime.
  | "cash"
  // The player threw a junction switch — a mechanical clack.
  | "switch"
  // The player cycled a signal — a lighter click.
  | "signal";

// The world-event half of the mapping: which cues one sim tick's events earn.
// Pure — the engine is handed the result, so this is unit-testable without an
// AudioContext. Click cues (switch/signal) are NOT here: they answer a pointer,
// not an event, and fire where the click lands (game.cycleSignal, Tile.pickArm).
// The cash cue is also not here — it needs the settled fare amount, which only
// the ledger knows (game.ts pushes it alongside).
export function cuesForEvents(events: SimEvent[]): SoundCue[] {
  const out: SoundCue[] = [];
  for (const e of events) {
    if (e.type === "arrived") out.push(e.matched ? "delivery" : "bounce");
  }
  return out;
}

// Ambient rolling-loop volume from how many trains are moving. Silent with the
// board at rest; a soft floor for the first train; each further train adds a
// diminishing step, capped so a busy board hums rather than roars. Tuned
// against laptop speakers: the first cut (base 0.02, lowpass 180Hz) was
// inaudible on anything without a woofer.
export const ROLLING_BASE = 0.055;
export const ROLLING_STEP = 0.022;
export const ROLLING_CAP = 0.14;

export function rollingGain(movingTrains: number): number {
  if (movingTrains <= 0) return 0;
  return Math.min(ROLLING_CAP, ROLLING_BASE + ROLLING_STEP * (movingTrains - 1));
}

// --- volume sliders ----------------------------------------------------------
//
// A slider's 0–100 to a gain. Not linear: loudness is perceived roughly on a
// log scale, so a linear gain puts almost all the audible range in the slider's
// bottom third and leaves the top half doing nothing. A squared curve spreads
// the usable range across the travel (-12dB at the midpoint, -6dB around 70%),
// the shape of an audio-taper fader. 0 is exactly silent, 100 exactly unity.
export function sliderGain(pct: number): number {
  const p = Math.max(0, Math.min(100, Number(pct) || 0)) / 100;
  return p * p;
}

// --- rail joints: the clackety-clack ----------------------------------------
//
// The iconic train sound is not a rumble, it is the double-knock of a bogie
// crossing a rail joint — and its RATE is the train's speed. That is why this
// is synthesised from the simulation's own `trainVelocity` (tiles/sec) rather
// than looped from a recording: a sample loop plays at whatever tempo it was
// recorded at, so it drifts against the train the player is watching, and the
// speed dial (1x/2x/4x) makes the mismatch obvious. Driving it from distance
// travelled keeps picture and sound locked together for free.
//
// One joint every quarter tile: at the 0.5 tiles/sec cruise speed
// (DEFAULT_SPEED) that is two knocks a second — a train rolling at an easy
// pace, and it speeds up exactly when the train does.
export const CLACK_SPACING_TILES = 0.25;

// Never fire more than this many in one frame. A backgrounded tab hands back a
// huge dt on return, which would otherwise arrive as a burst of dozens of
// clacks at once — a machine-gun, not a train.
export const MAX_CLACKS_PER_FRAME = 2;

// How many rail joints the fleet has just rolled over, given the distance
// accumulated since the last frame. Returns the clacks to play now and the
// remainder to carry forward, so no fraction of a joint is ever lost or
// double-counted. Pure, so the rhythm is testable without an AudioContext.
export function takeClacks(accumTiles: number): {
  clacks: number;
  rest: number;
} {
  if (!(accumTiles > 0)) return { clacks: 0, rest: Math.max(0, accumTiles || 0) };
  const due = Math.floor(accumTiles / CLACK_SPACING_TILES);
  if (due <= 0) return { clacks: 0, rest: accumTiles };
  const clacks = Math.min(due, MAX_CLACKS_PER_FRAME);
  // Everything beyond the cap is DISCARDED, not banked: those joints are in the
  // past, and carrying them forward would pay the burst back over the following
  // frames instead of dropping it.
  return { clacks, rest: accumTiles - due * CLACK_SPACING_TILES };
}
