import { gameConfig } from "@/gameConfig";
import { rollingGain, takeClacks, SoundCue } from "./cues";
import { SAMPLES } from "./samples";
import { createRollingBed, makeNoise, railJoint, synthCue } from "./synth";

// The game's sound engine: bundled CC0 samples for the discrete cues, and
// synthesis for the rolling ambience (see synth.ts for why that split). Four
// rules shape it:
//
//  1. NO-OP OFF THE BROWSER. `game.ts` calls in from the frame loop and the
//     event drain, both of which the unit tests drive headlessly via
//     `advance()`; with no window/AudioContext every entry point returns at
//     once, so nothing here can slow a test down or throw in one.
//  2. UNLOCKED BY A GESTURE. Browsers refuse an AudioContext created before
//     the user has interacted, so the context is built (or resumed) on the
//     first pointerdown/keydown, and that is also when the samples start
//     loading. Cues fired before then are dropped — a chime you were not there
//     for is not worth queueing.
//  3. MUTE IS LIVE. Every entry point reads `gameConfig.soundMuted`, so the
//     toggle silences new cues at once and ramps the bed out.
//  4. A MISSING SAMPLE IS NOT SILENCE. Until a cue's buffer has decoded — and
//     for good if its fetch failed — the cue plays its synthesised gesture
//     instead. The game is never mute because an asset did not arrive.

interface AudioEngine {
  // Play one cue now (dropped while muted / locked / headless).
  play(cue: SoundCue): void;
  // Feed the ambience, once per rendered frame: how many trains are moving,
  // how far the fleet travelled (tiles) since the last frame, and the speed of
  // the quickest train (tiles/sec). The bed's volume follows the count; the
  // rail-joint knocks follow the distance, so they stay locked to the trains
  // on screen at any speed setting.
  setTrainMotion(moving: number, tilesTravelled: number, fastest: number): void;
}

function createAudioEngine(): AudioEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let bed: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let installed = false;
  // Decoded cue samples. A cue absent from here falls back to synthesis.
  const buffers = new Map<SoundCue, AudioBuffer>();
  // Distance carried between frames, so no fraction of a rail joint is lost.
  let clackAccum = 0;

  const supported = (): boolean =>
    typeof window !== "undefined" && "AudioContext" in window;

  // Fetch + decode every sample into `buffers`. Runs once, on unlock. Each file
  // is independent: one failure costs that cue its sample (it falls back to
  // synthesis) and never blocks the others.
  function loadSamples(c: AudioContext): void {
    for (const [cue, spec] of Object.entries(SAMPLES) as [SoundCue, { url: string }][]) {
      fetch(spec.url)
        .then(r => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then(buf => c.decodeAudioData(buf))
        .then(decoded => buffers.set(cue, decoded))
        .catch(() => {
          /* keep the synth fallback for this cue */
        });
    }
  }

  function unlock(): void {
    if (ctx) {
      if (ctx.state === "suspended") void ctx.resume();
      return;
    }
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    noise = makeNoise(ctx);
    bed = createRollingBed(ctx, master, noise);
    loadSamples(ctx);
  }

  // Register the unlock listeners exactly once, from the first engine call made
  // in a browser. NOT `{once:true}`: a context can be suspended again (an iOS
  // tab switch does it), and resuming needs another gesture.
  function install(): void {
    if (installed || !supported()) return;
    installed = true;
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
  }

  const ready = (): boolean =>
    !!ctx && ctx.state === "running" && !gameConfig.soundMuted;

  function play(cue: SoundCue): void {
    install();
    if (!ready()) return;
    const c = ctx as AudioContext;
    const buf = buffers.get(cue);
    if (!buf) {
      synthCue(c, master as GainNode, noise as AudioBuffer, cue);
      return;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = SAMPLES[cue].gain;
    src.connect(g).connect(master as GainNode);
    src.start();
  }

  function setTrainMotion(moving: number, tilesTravelled: number, fastest: number): void {
    install();
    if (!ctx || !bed) return;
    const muted = gameConfig.soundMuted;
    // A short ramp per call: smooth, and self-correcting toward the latest
    // target without stacking automation events.
    bed.gain.setTargetAtTime(muted ? 0 : rollingGain(moving), ctx.currentTime, 0.2);
    if (muted || moving <= 0 || !(tilesTravelled > 0)) {
      // Standing still drops the remainder rather than banking it: a train that
      // stops mid-joint and later pulls away should start its rhythm afresh,
      // not pay off a debt from before the stop.
      clackAccum = 0;
      return;
    }
    clackAccum += tilesTravelled;
    const { clacks, rest } = takeClacks(clackAccum);
    clackAccum = rest;
    // Quieter as the board gets busier: several trains' joints overlapping at
    // full level turns rhythm into mush.
    const gain = 0.045 / Math.sqrt(Math.max(1, moving));
    for (let i = 0; i < clacks; i++) {
      railJoint(ctx, master as GainNode, noise as AudioBuffer, gain, fastest);
    }
  }

  return { play, setTrainMotion };
}

// The one engine. Created eagerly (it holds no resources until unlocked), used
// by game.ts for world cues and the ambience, and by the tile view for clicks.
export const gameAudio: AudioEngine = createAudioEngine();
