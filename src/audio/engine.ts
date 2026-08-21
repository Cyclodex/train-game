import { gameConfig } from "@/gameConfig";
import { rollingGain, SoundCue } from "./cues";

// The game's synthesised sound engine. Everything is generated with Web Audio
// primitives — no assets, nothing to load. Three rules shape it:
//
//  1. NO-OP OFF THE BROWSER. `game.ts` calls into this from the frame loop and
//     the event drain, both of which unit tests drive headlessly (advance());
//     without a window/AudioContext every call returns immediately.
//  2. UNLOCKED BY A GESTURE. Browsers refuse an AudioContext that starts before
//     the user has interacted with the page, so the context is created (or
//     resumed) on the first pointerdown/keydown and cues before that are simply
//     dropped — a chime you weren't there for is not worth queueing.
//  3. MUTE IS LIVE. Every entry point reads `gameConfig.soundMuted`; the toggle
//     silences new cues at once and ramps the ambient loop out.

interface AudioEngine {
  // Play one cue now (dropped while muted / locked / headless).
  play(cue: SoundCue): void;
  // Feed the ambient rolling loop: how many trains are moving this frame.
  // Called per frame; the loop's gain ramps smoothly toward rollingGain(n).
  setMovingTrains(n: number): void;
}

function createAudioEngine(): AudioEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let rolling: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let installed = false;

  const supported = (): boolean =>
    typeof window !== "undefined" && "AudioContext" in window;

  // One second of white noise, built once and reused by every percussive cue
  // and by the rolling loop.
  function noise(): AudioBuffer {
    if (noiseBuf) return noiseBuf;
    const c = ctx as AudioContext;
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return noiseBuf;
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
    // The ambient rolling bed: looped noise through a low lowpass, silent until
    // setMovingTrains ramps it up. Runs forever; its GAIN is the on/off switch.
    const src = ctx.createBufferSource();
    src.buffer = noise();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;
    lp.Q.value = 0.4;
    rolling = ctx.createGain();
    rolling.gain.value = 0;
    src.connect(lp).connect(rolling).connect(master);
    src.start();
  }

  // Register the unlock listeners exactly once, from the first engine call made
  // in a browser. Not {once:true}: a context can be re-suspended (e.g. iOS tab
  // switch), and resuming it takes another gesture.
  function install(): void {
    if (installed || !supported()) return;
    installed = true;
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
  }

  const ready = (): boolean =>
    !!ctx && ctx.state === "running" && !gameConfig.soundMuted;

  // A single enveloped oscillator note: freq (optionally gliding to freq2),
  // starting at `at`, peaking at `peak`, decaying exponentially over `dur`.
  function note(
    type: OscillatorType,
    freq: number,
    at: number,
    peak: number,
    dur: number,
    freq2?: number
  ): void {
    const c = ctx as AudioContext;
    const osc = c.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (freq2 !== undefined) osc.frequency.exponentialRampToValueAtTime(freq2, at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g).connect(master as GainNode);
    osc.start(at);
    osc.stop(at + dur + 0.05);
  }

  // A short filtered noise burst — the percussive half of clacks and thuds.
  function burst(
    filterType: BiquadFilterType,
    freq: number,
    at: number,
    peak: number,
    dur: number
  ): void {
    const c = ctx as AudioContext;
    const src = c.createBufferSource();
    src.buffer = noise();
    const f = c.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = 1;
    const g = c.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(master as GainNode);
    src.start(at);
    src.stop(at + dur + 0.05);
  }

  function play(cue: SoundCue): void {
    install();
    if (!ready()) return;
    const t = (ctx as AudioContext).currentTime;
    switch (cue) {
      case "delivery":
        // A rising two-note chime: G5 → C6.
        note("sine", 784, t, 0.16, 0.35);
        note("sine", 1046.5, t + 0.11, 0.18, 0.5);
        break;
      case "bounce":
        // A dull thud: a fast downward glide plus a low knock of noise.
        note("sine", 150, t, 0.3, 0.22, 60);
        burst("lowpass", 260, t, 0.18, 0.09);
        break;
      case "switch":
        // The points clack: a bright snap over a wooden thock.
        burst("bandpass", 2100, t, 0.16, 0.025);
        note("triangle", 290, t + 0.01, 0.1, 0.06);
        break;
      case "signal":
        // A lighter relay click.
        burst("bandpass", 3200, t, 0.1, 0.015);
        note("sine", 1350, t, 0.05, 0.05);
        break;
      case "cash":
        // The register: two quick ticks, then a bright ding. Scheduled a beat
        // after the call so it lands on top of (not inside) the delivery chime.
        burst("highpass", 4000, t + 0.16, 0.1, 0.02);
        burst("highpass", 4000, t + 0.23, 0.1, 0.02);
        note("sine", 1568, t + 0.3, 0.12, 0.4);
        break;
    }
  }

  function setMovingTrains(n: number): void {
    install();
    if (!ctx || !rolling) return;
    const target = gameConfig.soundMuted ? 0 : rollingGain(n);
    // A short ramp per frame call: smooth, and self-correcting toward the
    // latest target without stacking automation events.
    rolling.gain.setTargetAtTime(target, ctx.currentTime, 0.2);
  }

  return { play, setMovingTrains };
}

// The one engine. Created eagerly (it holds no resources until unlocked), used
// by game.ts for world cues and by the tile view for click cues.
export const gameAudio: AudioEngine = createAudioEngine();
