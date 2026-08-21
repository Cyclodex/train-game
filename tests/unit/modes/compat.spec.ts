import { describe, it, expect } from "vitest";
import { boardCapabilities } from "@/modes/compat";
import { MODES, modeById } from "@/modes";
import { networkMode } from "@/modes/network";
import { citizensMode } from "@/modes/citizens";
import { puzzleMode } from "@/modes/puzzle";
import { tycoonMode } from "@/modes/tycoon";
import { sandboxMode } from "@/modes/sandbox";
import { SCENARIOS, TestScenario } from "@/levels/test";
import { objectives } from "@/levels/test/scenarios/objectives";
import { networkmode } from "@/levels/test/scenarios/networkmode";
import { threecities } from "@/levels/test/scenarios/threecities";
import { DEFAULT_LEVEL } from "@/levels/default";
import { TrainDef } from "@/game";

function defsOf(s: TestScenario): TrainDef[] {
  return Object.values(s.trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
    spawnAtSec: t.spawnAtSec,
  }));
}

describe("boardCapabilities", () => {
  it("counts depots, stations and the roster on a small board", () => {
    const caps = boardCapabilities(objectives.level, defsOf(objectives));
    expect(caps.depots).toBe(2);
    expect(caps.stations).toBe(0);
    expect(caps.trains).toBe(1);
    expect(caps.homes).toBe(0);
    expect(caps.workplaces).toBe(0);
  });

  it("sees stations on the network board and towns on the citizens board", () => {
    expect(
      boardCapabilities(networkmode.level, defsOf(networkmode)).stations
    ).toBeGreaterThan(0);
    const three = boardCapabilities(threecities.level, defsOf(threecities));
    expect(three.homes).toBeGreaterThan(0);
    expect(three.workplaces).toBeGreaterThan(0);
  });
});

describe("mode fits", () => {
  it("network does not fit a station-less board, citizens not a town-less one", () => {
    const caps = boardCapabilities(objectives.level, defsOf(objectives));
    expect(networkMode.fits!(caps)).toMatch(/station/i);
    expect(citizensMode.fits!(caps)).toMatch(/town/i);
    // ...while the delivery modes do fit it.
    expect(puzzleMode.fits!(caps)).toBeNull();
    expect(tycoonMode.fits!(caps)).toBeNull();
  });

  it("the delivery modes refuse a board with no trains", () => {
    const caps = boardCapabilities(objectives.level, []);
    expect(puzzleMode.fits!(caps)).toMatch(/train/i);
    expect(tycoonMode.fits!(caps)).toMatch(/train/i);
  });

  it("sandbox fits anything (declares no requirements)", () => {
    expect(sandboxMode.fits).toBeUndefined();
  });

  it("the default board carries the default mode", () => {
    // The URL guard falls back to modeById(null); if the default mode did not
    // fit the default board, a plain /play would bounce to Sandbox.
    const caps = boardCapabilities(DEFAULT_LEVEL, [
      { id: "t", x: 0, y: 0, type: "people", wagonIds: [] },
    ]);
    const fallback = modeById(null);
    expect(fallback.fits?.(caps) ?? null).toBeNull();
  });
});

describe("every pinned scenario fits its own mode", () => {
  // The registry-wide guard (#114): a scenario that names a mode its own board
  // cannot carry would demo a dead ruleset — the exact bug the /test gallery
  // exists to prevent (see #112 for the sandbox-fallback variant of it).
  for (const s of SCENARIOS) {
    const mode = s.mode ?? (s.modeId ? modeById(s.modeId) : null);
    if (!mode?.fits) continue;
    it(`${s.id} fits ${mode.id}`, () => {
      const caps = boardCapabilities(s.level, defsOf(s));
      expect(mode.fits!(caps)).toBeNull();
    });
  }
});

describe("the picker roster declares sane requirements", () => {
  it("every registered mode with fits() rejects an EMPTY board with a reason", () => {
    const caps = boardCapabilities({}, []);
    for (const m of MODES) {
      if (!m.fits) continue;
      const reason = m.fits(caps);
      expect(reason, `${m.id} should not fit an empty board`).toBeTruthy();
      expect(reason!.length).toBeGreaterThan(8);
    }
  });
});
