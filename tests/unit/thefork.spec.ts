import { describe, it, expect } from "vitest";
import { createGame, TrainDef } from "@/game";
import { tycoonMode, THEFORK_ON_TIME_SEC } from "@/modes/tycoon";
import { scenarioById } from "@/levels/test/index";
import { THEFORK_TRAIN_COUNT } from "@/levels/test/scenarios/thefork";
import { Position } from "@/types";
import type { RouteStep } from "@/tiles/routePlanner";

// THE FORK — the first level authored as a TIMETABLE, and the proof that the
// pacing fix works end to end (docs/…/2026-08-22-level-pacing-design.md).
//
// The rule this file exists to enforce is the one the campaign already learned
// the hard way: an unwinnable level is not a hard level, it is a wall across
// the whole campaign, so every seeded board must be MEASURED winnable rather
// than assumed to be. Two boards were seeded on that assumption once and
// turned out to be shuttle demos that could only ever deliver one train.
//
// It also pins the numbers the star targets were tuned against. Payday and
// On time are both measured quantities; if the timetable or the fare model
// moves, one of these three cases goes red rather than the level quietly
// becoming trivial or impossible.

const T = Position.Top;
const B = Position.Bottom;
// The junction at 3,2, entered from the west. Arm 1 carries straight on to the
// green town in the east; arm 2 turns south to the orange one.
const JUNCTION = "3,2";
const ARM_EAST = 1;
const ARM_SOUTH = 2;
// The two-tile southern gap the level opens with.
const GAP: RouteStep[] = [
  { id: "3,3", a: T, b: B },
  { id: "3,4", a: T, b: B },
];

function defs(): TrainDef[] {
  const sc = scenarioById("thefork");
  return Object.values(sc.trains).map(t => ({
    id: t.id,
    x: t.x,
    y: t.y,
    type: t.type,
    wagonIds: (t.wagons ?? []).map(w => w.id),
    destinations: (t.routeDestinations ?? []).map(d => d.to),
    spawnAtSec: t.spawnAtSec,
  }));
}

function newGame() {
  const sc = scenarioById("thefork");
  return createGame(
    structuredClone(sc.level),
    defs(),
    200,
    tycoonMode,
    1,
    sc.colors,
    undefined,
    "board:thefork"
  );
}

// Play the level. `dawdleSec` is how long each train is left standing in the
// shed before it is sent; `setArm` false means never touching the points, so
// every south-bound train runs on to the wrong town.
function play(dawdleSec: number, setArm = true) {
  const game = newGame();
  game.startObjective();
  game.buildRoute(GAP);
  const held: Record<string, number> = {};
  let t = 0;
  while (t < 500 && game.objective.phase === "playing") {
    for (const d of defs()) {
      const train = game.sim.trains[d.id];
      if (!train || train.state !== "waiting") continue;
      held[d.id] = (held[d.id] ?? 0) + 0.1;
      if (held[d.id] < dawdleSec) continue;
      if (setArm) {
        const south = d.destinations?.[0] === "3,5";
        if (!game.switches[JUNCTION]) game.switches[JUNCTION] = {};
        game.switches[JUNCTION][Position.Left] = (south
          ? ARM_SOUTH
          : ARM_EAST) as never;
        game.advance(0.1);
        t += 0.1;
      }
      game.dispatch(d.id);
    }
    game.advance(0.1);
    t += 0.1;
  }
  const stars = Object.fromEntries(
    game.objective.stars.map((s: { id: string; earned: boolean }) => [
      s.id,
      s.earned,
    ])
  );
  return { game, t, stars, counters: game.objective.counters };
}

describe("thefork: the timetable is the level", () => {
  it("is winnable — all twelve trains, arriving over two minutes, get home", () => {
    const { game, t, counters } = play(0);
    expect(game.objective.phase).toBe("won");
    expect(counters.delivered).toBe(THEFORK_TRAIN_COUNT);
    expect(counters.mismatchedArrivals).toBe(0);
    // The point of the whole exercise: this board is SMALLER than
    // lakevalley-open (6x6 against 9x7) and lasts nearly four times as long
    // (measured 125s against 35s), because the trains arrive over time instead
    // of standing in a pile.
    expect(t).toBeGreaterThan(110);
    expect(t).toBeLessThan(THEFORK_ON_TIME_SEC);
  });

  it("delivers several trains to the SAME town — which needs the shed to clear", () => {
    // Six green trains all terminate at 5,2. Before a delivered train was
    // stabled and taken off the board, the first one parked there for ever and
    // the rest queued up the line: 2 of 8 delivered on the first cut of this
    // level, and no amount of play could finish it.
    const { counters } = play(0);
    expect(counters.delivered).toBe(THEFORK_TRAIN_COUNT);
  });

  it("dawdling still wins, but loses On time — the timetable is the pressure", () => {
    const { game, t, stars, counters } = play(10);
    expect(game.objective.phase).toBe("won");
    expect(counters.delivered).toBe(THEFORK_TRAIN_COUNT);
    expect(t).toBeGreaterThan(THEFORK_ON_TIME_SEC);
    expect(stars["on-time"]).toBe(false);
  });

  it("never setting the points costs Perfect colours, not the win", () => {
    // Every south-bound train runs straight on to the green town, bounces, and
    // has to come round again. Train Valley's own rule: a misroute is paid for
    // in money and time, never in a lost level.
    const { game, stars, counters } = play(0, false);
    expect(game.objective.phase).toBe("won");
    expect(counters.mismatchedArrivals).toBeGreaterThan(0);
    expect(stars["perfect-colours"]).toBe(false);
  });

  it("the three stars pull apart: a prompt, accurate line takes all three", () => {
    const { stars } = play(0);
    expect(stars["payday"]).toBe(true);
    expect(stars["perfect-colours"]).toBe(true);
    expect(stars["on-time"]).toBe(true);
  });
});
