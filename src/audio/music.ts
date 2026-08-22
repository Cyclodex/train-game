import lassoLadyUrl from "./music/lasso-lady.ogg?url";
import backfootUrl from "./music/backfoot.ogg?url";
import oldWestUrl from "./music/old-west-style.ogg?url";
import bluebonnetUrl from "./music/bluebonnet.ogg?url";

// THE MUSIC — a small CC0 playlist under the game, and the player that runs it.
//
// Why there is music at all: the discrete cues are punctual and the ambience
// only sounds while something rolls, so between them a board at rest was
// SILENT — and silence in a building game reads as "the sound is broken", not
// as calm. Every game in this genre (Railroad Tycoon, Transport Tycoon, Train
// Valley) runs a bed of music for exactly that reason.
//
// Why these four: a train-tycoon wants the bluegrass/western lilt Railroad
// Tycoon made the genre's signature, so three of them are banjo/western at an
// easy 60–120 bpm, and the fourth is a soft one so a long session has somewhere
// to breathe. All explicitly CC0 on OpenGameArt (CC-BY and OGA-BY candidates
// were rejected — provenance and the CC0-only rule are in docs/ASSETS.md).
//
// Why a MEDIA ELEMENT rather than decoded buffers: a track is a minute or more,
// and decoding four of them is ~60MB of PCM held for the session. An
// <audio> element streams from its file instead, and still routes through the
// engine's graph (createMediaElementSource) so the master mute and the music
// bus apply to it like to everything else.

export interface MusicTrack {
  url: string;
  title: string;
  author: string; // the OpenGameArt username
  // Measured integrated level (dBFS) of the file, via the game's own decoder.
  // The per-track gain is derived from it so the playlist sits at one level;
  // the files as published differ by 10dB.
  dbfs: number;
}

export const MUSIC_TRACKS: MusicTrack[] = [
  { url: lassoLadyUrl, title: "Lasso Lady", author: "congusbongus", dbfs: -18.6 },
  { url: backfootUrl, title: "Backfoot", author: "centurionofwar", dbfs: -16.3 },
  { url: oldWestUrl, title: "Old West Style", author: "Tozan", dbfs: -27.7 },
  { url: bluebonnetUrl, title: "Bluebonnet", author: "kistol", dbfs: -22.4 },
];

// Where every track is brought to, in dBFS, before the bus level. Soft: the
// music is a bed for the clacks and chimes, not the foreground.
export const MUSIC_TARGET_DBFS = -22;
// The bus below the cues. Cues play at 0.4–0.7 of a full-scale sample; this
// keeps the music a clear step under them.
export const MUSIC_BUS_LEVEL = 0.55;
// Fades, so toggles and view changes never cut the music dead.
export const MUSIC_FADE_SEC = 2.5;
// Silence between tracks — a breath, not a gap you notice.
export const MUSIC_GAP_SEC = 1.5;

// The gain that brings a track of the given level to MUSIC_TARGET_DBFS. Capped
// so a very quiet master is not boosted into clipping (Old West Style at
// -27.7dBFS has a -11.5dBFS peak; ×1.9 leaves headroom).
export function trackGain(dbfs: number): number {
  return Math.min(2, Math.pow(10, (MUSIC_TARGET_DBFS - dbfs) / 20));
}

// The playlist order: straight round, wrapping. Pure so it can be tested.
export function nextTrackIndex(current: number, count: number): number {
  if (count <= 0) return 0;
  return (current + 1) % count;
}

export interface MusicPlayer {
  // Want music (true) or not (false). Idempotent; fades either way. The first
  // `true` starts the playlist, a later `false` PAUSES it (position kept), so
  // switching views resumes the same track rather than restarting.
  setOn(on: boolean): void;
  // The user's music level, 0–1, applied on its own node so it never fights
  // the on/off fade. Smoothed, so a slider drag is heard without zipper noise.
  setVolume(v: number): void;
}

export function createMusicPlayer(ctx: AudioContext, dest: AudioNode): MusicPlayer {
  // Three gains in series, each with one job: `level` normalises the track,
  // `bus` is the on/off fade (0 ↔ 1), `volume` is MUSIC_BUS_LEVEL × the user's
  // slider. Keeping the fade and the slider apart is what lets a drag during a
  // fade do the right thing — and keeps the bus level from being applied twice.
  const volume = ctx.createGain();
  volume.gain.value = MUSIC_BUS_LEVEL;
  volume.connect(dest);
  const bus = ctx.createGain();
  bus.gain.value = 0;
  bus.connect(volume);
  const level = ctx.createGain();
  level.connect(bus);

  const el = new Audio();
  el.preload = "auto";
  // One element for the whole playlist: createMediaElementSource can only be
  // called once per element, so the track changes by swapping `src`.
  ctx.createMediaElementSource(el).connect(level);

  // Start somewhere in the list so two sessions do not always open the same
  // way. Not seeded: nothing about the music needs to be reproducible.
  let index = Math.floor(Math.random() * MUSIC_TRACKS.length);
  let wanted = false;
  let loaded = false;
  let pauseTimer = 0;
  let failures = 0;

  function load(i: number): void {
    const t = MUSIC_TRACKS[i];
    level.gain.value = trackGain(t.dbfs);
    el.src = t.url;
    loaded = true;
  }

  function play(): void {
    // play() rejects if the document has not been activated yet; the first
    // call comes from inside the unlock gesture, so in practice it resolves —
    // but a rejection must never surface as an unhandled promise.
    el.play().catch(() => {
      /* stays paused; the next setOn(true) tries again */
    });
  }

  function advance(): void {
    index = nextTrackIndex(index, MUSIC_TRACKS.length);
    load(index);
    if (wanted) play();
  }

  el.addEventListener("ended", () => {
    failures = 0;
    window.setTimeout(advance, MUSIC_GAP_SEC * 1000);
  });
  el.addEventListener("error", () => {
    // A file that will not load is skipped — but if EVERY file fails (offline,
    // a broken deploy), stop trying rather than spin through the list forever.
    failures += 1;
    if (failures < MUSIC_TRACKS.length) window.setTimeout(advance, MUSIC_GAP_SEC * 1000);
  });

  function setOn(on: boolean): void {
    if (on === wanted) return;
    wanted = on;
    window.clearTimeout(pauseTimer);
    const now = ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    if (on) {
      if (!loaded) load(index);
      play();
      bus.gain.linearRampToValueAtTime(1, now + MUSIC_FADE_SEC);
    } else {
      bus.gain.linearRampToValueAtTime(0, now + MUSIC_FADE_SEC);
      // Pause once the fade is done, so the element is not left playing into
      // a closed gain for the rest of the session.
      pauseTimer = window.setTimeout(() => el.pause(), MUSIC_FADE_SEC * 1000 + 50);
    }
  }

  function setVolume(v: number): void {
    const target = MUSIC_BUS_LEVEL * Math.max(0, Math.min(1, v));
    volume.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
  }

  return { setOn, setVolume };
}
