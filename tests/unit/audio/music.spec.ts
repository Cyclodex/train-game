import { describe, it, expect } from "vitest";
import {
  MUSIC_TRACKS,
  MUSIC_TARGET_DBFS,
  nextTrackIndex,
  trackGain,
} from "@/audio/music";

describe("the CC0 music playlist", () => {
  it("has a handful of tracks, each with a file, a credit and a measured level", () => {
    expect(MUSIC_TRACKS.length).toBeGreaterThanOrEqual(3);
    for (const t of MUSIC_TRACKS) {
      expect(t.url, t.title).toBeTruthy();
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.author.length).toBeGreaterThan(0);
      // A plausible integrated level for published music — not silence, not
      // a clipped master.
      expect(t.dbfs).toBeLessThan(-8);
      expect(t.dbfs).toBeGreaterThan(-40);
    }
  });

  it("normalises every track to the target level, within the boost cap", () => {
    for (const t of MUSIC_TRACKS) {
      const g = trackGain(t.dbfs);
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThanOrEqual(2);
      // Unless capped, gain × level lands exactly on the target.
      if (g < 2) {
        const landed = t.dbfs + 20 * Math.log10(g);
        expect(landed).toBeCloseTo(MUSIC_TARGET_DBFS, 6);
      }
    }
  });

  it("brings a quiet and a loud master to the same place", () => {
    // -28 and -16 dBFS: 12dB apart as published, equal after the gain.
    const quiet = -28 + 20 * Math.log10(trackGain(-28));
    const loud = -16 + 20 * Math.log10(trackGain(-16));
    expect(quiet).toBeCloseTo(loud, 6);
  });

  it("caps the boost so a very quiet file is not pushed into clipping", () => {
    expect(trackGain(-60)).toBe(2);
  });

  it("walks the playlist round and wraps", () => {
    expect(nextTrackIndex(0, 4)).toBe(1);
    expect(nextTrackIndex(3, 4)).toBe(0);
    expect(nextTrackIndex(5, 0)).toBe(0);
  });
});
