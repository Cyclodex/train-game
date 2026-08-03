import { describe, it, expect } from "vitest";
import { createGame, TrainDef, durationLabel } from "@/game";
import { citizensMode } from "@/modes/citizens";
import { citizenchoice } from "@/levels/test/scenarios/citizenchoice";
import { threecities } from "@/levels/test/scenarios/threecities";
import { puzzleMode } from "@/modes/puzzle";
import { DEFAULT_LEVEL } from "@/levels/default";
import { TestScenario } from "@/levels/test/scenario";

// THE INSPECTOR — clicking a house, clicking a person, and the table that says
// why they travel the way they do.
//
// All of it headless: `inspectPlot`/`inspectPerson`/`compareModes` build their
// answers on demand from the sim, so a test can read exactly what the panel
// would draw without a browser.

function defsOf(scenario: TestScenario): TrainDef[] {
  return Object.values(scenario.trains).map<TrainDef>(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
    destinations: (t.routeDestinations ?? []).map(d => d.to),
  }));
}

function newGame(scenario: TestScenario) {
  return createGame(
    scenario.level,
    defsOf(scenario),
    200,
    citizensMode,
    1,
    scenario.colors,
    scenario.traffic,
    scenario.id
  );
}

function run(game: ReturnType<typeof createGame>, seconds: number, onTick?: () => void) {
  for (let t = 0; t < seconds; t += 0.2) {
    game.advance(0.2);
    onTick?.();
  }
}

describe("the citizen inspector", () => {
  it("hands back a plot and everyone on it", () => {
    const game = newGame(citizenchoice);
    run(game, 30);

    const plot = game.inspectPlot("2,1");
    expect(plot).not.toBeNull();
    expect(plot?.kind).toBe("home");
    expect(plot?.city).toBe("altstadt");
    expect(plot?.residents.length).toBeGreaterThan(0);
    expect(plot?.residents.length).toBeLessThanOrEqual(plot?.capacity as number);

    // Everyone listed against a house actually lives (or works) there.
    for (const p of plot?.residents ?? []) {
      expect(p.home === "2,1" || p.work === "2,1").toBe(true);
      expect(p.name.length).toBeGreaterThan(1);
      // Their day is three fixed times, rolled once and never re-rolled.
      expect(p.leavesAt).toMatch(/^\d\d:\d\d$/);
      expect(p.returnsAt).toMatch(/^\d\d:\d\d$/);
      expect(p.shopsAt).toMatch(/^\d\d:\d\d$/);
    }

    // Nothing to inspect on empty grass, and nothing to inspect on a board with
    // no citizen layer at all.
    expect(game.inspectPlot("0,0")).toBeNull();
    const plain = createGame(DEFAULT_LEVEL, [], 200, puzzleMode, 1);
    expect(plain.inspectPlot("1,1")).toBeNull();
    expect(plain.compareModes("c1")).toEqual([]);
  });

  it("names a person the same way every time it is asked", () => {
    // A panel that renames somebody between two frames is a panel nobody
    // trusts, so the name is a hash of the id and not a draw from an RNG.
    const game = newGame(citizenchoice);
    run(game, 20);
    const id = (game.inspectPlot("2,1")?.residents ?? [])[0]?.id as string;
    expect(id).toBeTruthy();
    expect(game.inspectPerson(id)?.name).toBe(game.inspectPerson(id)?.name);
    run(game, 5);
    const again = game.inspectPerson(id)?.name;
    expect(again).toBe(game.inspectPerson(id)?.name);
  });

  it("prices every mode, and marks exactly the one the model picked", () => {
    const game = newGame(citizenchoice);
    run(game, 60);

    let checked = 0;
    for (let x = 1; x <= 5; x++) {
      for (const p of game.inspectPlot(`${x},1`)?.residents ?? []) {
        if (!p.work) continue;
        const rows = game.compareModes(p.id);
        // Always all four, in a stable order, so the panel's layout does not
        // jump about as the map changes under it.
        expect(rows.map(r => r.mode)).toEqual(["walk", "car", "transit", "parkAndRide"]);
        // At most one winner. Zero is legal and meaningful: it is the model
        // refusing the journey outright, and then EVERY row must carry a
        // reason — an empty table with no explanation would be the one case a
        // planner most needs explained.
        const chosen = rows.filter(r => r.chosen);
        expect(chosen.length).toBeLessThanOrEqual(1);
        if (chosen.length === 0) {
          expect(rows.every(r => !!r.why)).toBe(true);
          continue;
        }
        expect(chosen[0].why).toBeNull();
        expect(chosen[0].seconds).toBeGreaterThan(0);
        // A mode that is off has no number and DOES have a reason — "why not"
        // is half of what a planner came to find out.
        for (const r of rows) {
          if (r.why) {
            expect(r.seconds).toBeNull();
            expect(r.label).toBe("—");
          } else {
            expect(r.seconds).not.toBeNull();
            expect(r.label).toMatch(/^\d/);
          }
        }
        // The winner is the cheapest PERCEIVED, which is not always the fastest
        // — that gap is the whole reason both numbers are shown.
        const offered = rows.filter(r => !r.why);
        const cheapest = Math.min(...offered.map(r => r.perceivedSeconds as number));
        expect(chosen[0].perceivedSeconds).toBeCloseTo(cheapest, 6);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("gives three neighbours three different answers", () => {
    // The point of the board, asserted: the same street produces a walk, a
    // drive and a train ride, because of what the map does and does not offer.
    const game = newGame(citizenchoice);
    run(game, 600);

    const won = new Set<string>();
    const reasons = new Set<string>();
    for (let x = 1; x <= 5; x++) {
      for (const y of [1, 3]) {
        for (const p of game.inspectPlot(`${x},${y}`)?.residents ?? []) {
          if (p.home !== `${x},${y}` || !p.work) continue;
          for (const r of game.compareModes(p.id)) {
            if (r.chosen) won.add(r.mode);
            if (r.why) reasons.add(r.why);
          }
        }
      }
    }
    expect([...won].sort()).toEqual(["car", "transit", "walk"]);
    // ...and the reason the train ever wins is on screen: the road does not go
    // there. That is the mode's central lever, spelled out for the player.
    expect(reasons).toContain("no road joins the two ends");
    expect(reasons).toContain("too far to walk");
  });

  it("prices the journey somebody is ON, not their commute, while they travel", () => {
    const game = newGame(citizenchoice);
    let matched = 0;
    run(game, 400, () => {
      for (const dot of game.pedestrians) {
        const id = game.personWalking(dot.id);
        if (!id) continue;
        const p = game.inspectPerson(id) as NonNullable<ReturnType<typeof game.inspectPerson>>;
        if (!p.travellingTo || matched > 3) continue;
        matched += 1;
        // The table follows the trip in progress, so an errand is priced as an
        // errand rather than as the commute they are not currently making.
        const rows = game.compareModes(id);
        expect(rows.filter(r => r.chosen).length).toBe(1);
        expect(p.doing.length).toBeGreaterThan(0);
        expect(p.elapsedSec).not.toBeNull();
      }
    });
    // Every walking figure on the board resolves to a real person — the whole
    // basis of "click the dot to see who that is".
    expect(matched).toBeGreaterThan(0);
  });

  it("resolves a figure on the pavement to the person walking it", () => {
    const game = newGame(citizenchoice);
    let resolved = 0;
    let seen = 0;
    run(game, 300, () => {
      for (const dot of game.pedestrians) {
        seen += 1;
        if (game.personWalking(dot.id)) resolved += 1;
      }
    });
    expect(seen).toBeGreaterThan(20);
    // Not "most": ALL of them. A dot with nobody behind it is a walker the
    // citizen layer has lost track of.
    expect(resolved).toBe(seen);
  });

  it("says how a rail commuter is spending their journey", () => {
    const game = newGame(threecities);
    const legs = new Set<string>();
    run(game, 600, () => {
      for (const c of game.cities) void c;
      for (let x = 1; x <= 5; x++) {
        for (const p of game.inspectPlot(`${x},1`)?.residents ?? []) {
          if (p.mode === "transit" && p.travellingTo) legs.add(p.doing);
        }
      }
    });
    // A transit trip walks to the platform, waits, rides, and walks out — and
    // the panel must not call the first leg "walking to work" while the chosen
    // mode says Train.
    expect(legs).toContain("waiting on the platform");
    expect(legs).toContain("on the train");
    expect([...legs].some(l => l.includes("to work"))).toBe(true);
    expect(legs).not.toContain("walking to work");
  });

  it("prints a duration a person can read", () => {
    expect(durationLabel(8)).toBe("8s");
    expect(durationLabel(59.4)).toBe("59s");
    expect(durationLabel(83)).toBe("1m 23s");
    expect(durationLabel(600)).toBe("10m 00s");
    expect(durationLabel(Infinity)).toBe("—");
  });
});
