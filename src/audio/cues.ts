import { SimEvent } from "@/sim/simulation";

// The game's sound vocabulary. Every cue is a short synthesised gesture (see
// engine.ts); nothing here loads assets. The names are the contract between the
// event stream and the synth — the mapping below and the click handlers in the
// views speak in these.
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
