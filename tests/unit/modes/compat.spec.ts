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
import { DEFAULT_LEVEL, defaultTrains } from "@/levels/default";
import { CAMPAIGN } from "@/campaign";
import { TrainsDefinition } from "@/types";
import { TrainDef } from "@/game";

// Mirrors PlayView's buildTrainDefs: the same shape boardCapabilities is fed
// in the app, so a capability derived here is the one the guard would see.
function defsOfTrains(trains: TrainsDefinition): TrainDef[] {
  return Object.values(trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
    spawnAtSec: t.spawnAtSec,
  }));
}

function defsOf(s: TestScenario): TrainDef[] {
  return defsOfTrains(s.trains);
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
    //
    // The REAL roster, not a hand-built stand-in: with a synthetic one-train
    // array this passed even if defaultTrains() returned nothing — which is the
    // precise regression it exists to catch, since an empty roster is exactly
    // what makes Puzzle unfit.
    const caps = boardCapabilities(DEFAULT_LEVEL, defsOfTrains(defaultTrains()));
    expect(caps.trains).toBeGreaterThan(0);
    const fallback = modeById(null);
    expect(fallback.fits?.(caps) ?? null).toBeNull();
  });
});

describe("every campaign level carries the mode it pins", () => {
  // `campaign.ts` pins its own modeId per level, independently of the
  // scenario's — PlayView opens `?mode=<modeId>&board=<id>` and ignores
  // `scenario.modeId`. The registry sweep above never saw those, so a campaign
  // entry pinned to a mode its board cannot carry would be silently downgraded
  // by the URL guard (#114): the player clicks "Lake Valley" and gets Puzzle.
  for (const level of CAMPAIGN) {
    it(`${level.id} fits ${level.modeId}`, () => {
      const scenario = SCENARIOS.find(s => s.id === level.id);
      expect(scenario, `campaign level "${level.id}" is not a registered scenario`).toBeDefined();
      const mode = modeById(level.modeId);
      expect(mode.id, `campaign level "${level.id}" pins an unregistered mode`).toBe(
        level.modeId
      );
      const caps = boardCapabilities(scenario!.level, defsOf(scenario!));
      expect(mode.fits?.(caps) ?? null).toBeNull();
    });
  }
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
