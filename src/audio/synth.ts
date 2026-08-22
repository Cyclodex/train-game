import { SoundCue } from "./cues";

// THE SYNTHESISED HALF of the sound layer, and it is here for two distinct
// reasons — one a safety net, one a deliberate choice:
//
//  1. FALLBACK for the discrete cues. The bundled samples are fetched and
//     decoded after the AudioContext unlocks; a cue fired before that (or on a
//     build where a file failed to load) still has to make a noise rather than
//     silently doing nothing. These gestures are that floor.
//
//  2. THE ROLLING AMBIENCE, which is synthesised BY PREFERENCE. A recorded
//     loop plays at the tempo it was recorded at, so it drifts against the
//     train on screen — and the speed dial (1x/2x/4x) makes the mismatch
//     plain. Driving the bed and its rail-joint knocks from the simulation's
//     own velocity locks picture to sound at every speed, which no loop can
//     do. (There is also no CC0 train recording worth having: the usable ones
//     are share-alike, which is exactly the licence we are avoiding.)

// One second of white noise, the raw material for every percussive gesture and
// for the rolling bed. Built once per context and reused — it is touched on the
// hot path (a rail joint knock can fire twice a frame).
export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// A single enveloped oscillator note, optionally gliding from `freq` to `freq2`.
function note(
  ctx: AudioContext,
  dest: AudioNode,
  type: OscillatorType,
  freq: number,
  at: number,
  peak: number,
  dur: number,
  freq2?: number
): void {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (freq2 !== undefined) osc.frequency.exponentialRampToValueAtTime(freq2, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(dest);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

// A short filtered noise burst — the percussive half of clacks and thuds.
function burst(
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  filterType: BiquadFilterType,
  freq: number,
  at: number,
  peak: number,
  dur: number
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  // Start at a random offset so repeated hits are not bit-identical: the rail
  // joints fire twice a second for minutes on end, and the same 25ms of noise
  // over and over reads as a synthesiser rather than as track.
  const offset = Math.random() * Math.max(0, noise.duration - dur - 0.01);
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = 1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(at, offset);
  src.stop(at + dur + 0.05);
}

// The fallback gesture for one cue. Only reached when the cue's sample is not
// (yet) available — see the module note.
export function synthCue(
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  cue: SoundCue
): void {
  const t = ctx.currentTime;
  switch (cue) {
    case "delivery":
      note(ctx, dest, "sine", 784, t, 0.16, 0.35);
      note(ctx, dest, "sine", 1046.5, t + 0.11, 0.18, 0.5);
      break;
    case "bounce":
      note(ctx, dest, "sine", 150, t, 0.3, 0.22, 60);
      burst(ctx, dest, noise, "lowpass", 260, t, 0.18, 0.09);
      break;
    case "switch":
      burst(ctx, dest, noise, "bandpass", 2100, t, 0.16, 0.025);
      note(ctx, dest, "triangle", 290, t + 0.01, 0.1, 0.06);
      break;
    case "signal":
      burst(ctx, dest, noise, "bandpass", 3200, t, 0.1, 0.015);
      note(ctx, dest, "sine", 1350, t, 0.05, 0.05);
      break;
    case "cash":
      burst(ctx, dest, noise, "highpass", 4000, t + 0.16, 0.1, 0.02);
      burst(ctx, dest, noise, "highpass", 4000, t + 0.23, 0.1, 0.02);
      note(ctx, dest, "sine", 1568, t + 0.3, 0.12, 0.4);
      break;
  }
}

// One axle crossing a rail joint: a tight knock with a little body under it.
function knock(
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  at: number,
  gain: number
): void {
  burst(ctx, dest, noise, "bandpass", 900 + Math.random() * 350, at, gain, 0.035);
  note(ctx, dest, "sine", 95, at, gain * 0.5, 0.05, 62);
}

// THE DOUBLE KNOCK — a bogie has two axles, so a joint is heard twice, and that
// gap is the whole character of the sound. The spacing shortens as the train
// speeds up (the axles cross the same joint sooner), which is why the caller
// passes the speed rather than a fixed tempo.
export function railJoint(
  ctx: AudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  gain: number,
  tilesPerSec: number
): void {
  const t = ctx.currentTime;
  // Axle spacing as a fraction of a tile, converted to seconds at this speed,
  // and clamped so a crawling train does not stretch the pair into two
  // unrelated knocks (or a racing one collapse them into a single click).
  const gap = Math.min(0.11, Math.max(0.028, 0.035 / Math.max(0.05, tilesPerSec)));
  knock(ctx, dest, noise, t, gain);
  knock(ctx, dest, noise, t + gap, gain * 0.72);
}

// The ambient rolling bed: looped noise under a lowpass, with a slow LFO on the
// FILTER (never on the gain — a gain LFO would be audible as a hum even at
// rest). Returns the gain node, which is the bed's on/off switch: the caller
// ramps it from the number of moving trains.
export function createRollingBed(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer): GainNode {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  // 320Hz, not the 180Hz this started at: below ~250Hz a laptop speaker
  // reproduces almost nothing, and the bed was inaudible on every machine
  // without a woofer.
  lp.frequency.value = 320;
  lp.Q.value = 0.7;
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 2.8;
  const depth = ctx.createGain();
  depth.gain.value = 90; // Hz of cutoff wobble either side of 320
  lfo.connect(depth).connect(lp.frequency);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(lp).connect(gain).connect(dest);
  src.start();
  lfo.start();
  return gain;
}
