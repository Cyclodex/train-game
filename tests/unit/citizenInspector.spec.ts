import { describe, it, expect } from "vitest";
import { boardDuration, createGame, inGameDuration, PersonCard, TrainDef } from "@/game";
import { citizensMode, citizensModeWith } from "@/modes/citizens";
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

// The shipped mode by default. `tuning` compresses the day for the tests that
// need several of them to pass — the shipped 1800s day is calibrated for
// playing, not for a suite.
function newGame(scenario: TestScenario, tuning?: Parameters<typeof citizensModeWith>[0]) {
  return createGame(
    scenario.level,
    defsOf(scenario),
    200,
    tuning ? citizensModeWith(tuning) : citizensMode,
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
      // Their day is a routine of fixed times, rolled once and never re-rolled.
      // A list rather than three fields: how long it is depends on which life
      // they were given (a tradesperson runs six errands, a worker three).
      expect(p.stageLabel.length).toBeGreaterThan(2);
      expect(p.schedule.length).toBeGreaterThanOrEqual(3);
      for (const line of p.schedule) {
        expect(line.at).toMatch(/^\d\d:\d\d$/);
        expect(line.what.length).toBeGreaterThan(2);
      }
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
        // Always all six, in a stable order, so the panel's layout does not
        // jump about as the map changes under it.
        expect(rows.map(r => r.mode)).toEqual([
          "walk",
          "car",
          "bike",
          "transit",
          "parkAndRide",
          "bikeAndRide",
        ]);
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
            expect(r.label).toMatch(/^(<1 min|\d+ min|\d+h)/);
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
    // The board's three founding answers still all happen — and since phase C′
    // the bike takes its promised slice of the mid-range commutes too, so the
    // same street now produces FOUR ways to work.
    for (const mode of ["car", "transit", "walk", "bike"]) {
      expect(won.has(mode)).toBe(true);
    }
    // ...and the reason the train ever wins is on screen: the road does not go
    // there. That is the mode's central lever, spelled out for the player.
    expect(reasons).toContain("no road joins the two ends");
    expect(reasons).toContain("further than they will go");
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

  it("locates a person wherever they happen to be — the pin's whole job", () => {
    const game = newGame(citizenchoice);

    // At rest, before anyone sets off: the pin sits on the tile they are in.
    const first = (game.inspectPlot("2,1")?.residents ?? [])[0];
    expect(first).toBeTruthy();
    const home = game.locatePerson(first.id);
    expect(home?.on).toBe("indoors");
    expect(home?.x).toBeCloseTo(2.5 * 200, 6);
    expect(home?.y).toBeCloseTo(1.5 * 200, 6);

    // ...and over a day it follows them onto every kind of thing that carries
    // somebody. Each of these is a different sampler, and a pin that only knew
    // about walkers would silently stick to a doorway for half the population.
    const modes = new Set<string>();
    const moved = new Map<string, number>();
    run(game, 900, () => {
      for (const dot of game.pedestrians) {
        const id = game.personWalking(dot.id);
        if (!id) continue;
        const fix = game.locatePerson(id) as NonNullable<ReturnType<typeof game.locatePerson>>;
        modes.add(fix.on);
        // A walker's pin is ON the walker, not a tile centre near them.
        if (fix.on === "foot") {
          expect(fix.x).toBeCloseTo(dot.x, 6);
          expect(fix.y).toBeCloseTo(dot.y, 6);
          moved.set(id, (moved.get(id) ?? 0) + 1);
        }
      }
      for (let x = 1; x <= 5; x++) {
        for (const p of game.inspectPlot(`${x},1`)?.residents ?? []) {
          const fix = game.locatePerson(p.id);
          if (fix) modes.add(fix.on);
        }
      }
    });
    // Walking, driving, riding and standing about all resolve to somewhere.
    expect(modes.has("foot")).toBe(true);
    expect(modes.has("car")).toBe(true);
    expect(modes.has("indoors")).toBe(true);
    expect([...moved.values()].some(n => n > 5)).toBe(true);

    // Somebody who has left town has no position, and the pin must vanish
    // rather than freeze over their old address.
    expect(game.locatePerson("nobody")).toBeNull();
  }, 30000);

  it("follows a rail passenger onto the train itself", () => {
    // The one case that needed a new field: `riders` knew who was on which
    // train but only that way round, and a pin over one named person needs the
    // arrow pointing the other way.
    const game = newGame(threecities);
    let onTrain = 0;
    const seen = new Set<number>();
    run(game, 900, () => {
      for (let x = 1; x <= 5; x++) {
        for (const p of game.inspectPlot(`${x},1`)?.residents ?? []) {
          const fix = game.locatePerson(p.id);
          if (fix?.on !== "train") continue;
          onTrain += 1;
          seen.add(Math.round(fix.x));
        }
      }
    });
    expect(onTrain).toBeGreaterThan(0);
    // A pin on a moving train moves. A stationary one would mean it had latched
    // onto a platform and called it a train.
    const xs = [...seen];
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(400);
  }, 30000);

  it("says WHY somebody is unhappy, not just that they are", () => {
    // A mood is not actionable; the journey behind it is. Every scored trip is
    // remembered with its two numbers, so the card can name the failure the
    // player has to fix.
    const game = newGame(citizenchoice, { secPerDay: 300 });
    run(game, 1200);

    const notes: string[] = [];
    let worst: PersonCard | null = null;
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 5; y++) {
        for (const p of game.inspectPlot(`${x},${y}`)?.residents ?? []) {
          if (p.home !== `${x},${y}`) continue;
          notes.push(...p.recent.map(n => n.text));
          if (!worst || p.mood < worst.mood) worst = p;
        }
      }
    }
    // Everyone who has travelled carries their evidence...
    expect(notes.length).toBeGreaterThan(20);
    // ...in words a player can act on, with both numbers in them.
    expect(notes.some(t => /took .* — .*longer than they expected/.test(t))).toBe(true);
    // ...and the unhappiest person on the board can say what went wrong.
    expect((worst as PersonCard).recent.length).toBeGreaterThan(0);
    expect((worst as PersonCard).recent.some(n => !n.good)).toBe(true);
  }, 30000);

  it("does not punish a next-door commute for being a walk", () => {
    // THE bug this rule exists for. A plot-to-plot straight line is not a walk:
    // the real one goes down the drive, along the pavement and up the other
    // drive, a near-constant 2.5 tiles whatever the separation. Without that,
    // the panel quoted a one-tile commute at 4s, the walker took 15-20s, and the
    // citizen was scored against the same optimistic distance — maximum
    // unhappiness twice a day, and gone from the board by the third.
    const game = newGame(citizenchoice, { secPerDay: 300 });
    run(game, 5);

    // Somebody whose job is next door.
    let nextDoor: PersonCard | null = null;
    for (let x = 1; x <= 5 && !nextDoor; x++) {
      for (const p of game.inspectPlot(`${x},1`)?.residents ?? []) {
        if (p.work && Math.abs(Number(p.work.split(",")[0]) - x) === 1 && p.work.endsWith(",1")) {
          nextDoor = p;
          break;
        }
      }
    }
    expect(nextDoor).not.toBeNull();
    const id = (nextDoor as PersonCard).id;

    // The quote is honest about the two driveway legs...
    const walk = game.compareModes(id).find(m => m.mode === "walk");
    expect(walk?.seconds).toBeGreaterThan(10);
    // ...and they are still not driving next door, which is what charging the
    // access to the walk ALONE produced (the walk share on citizenwalk fell
    // from 89% to 46%). A driver walks to their car too.
    expect(game.compareModes(id).find(m => m.chosen)?.mode).toBe("walk");

    // Over several days it makes them happy, not miserable.
    run(game, 1200);
    const after = game.inspectPerson(id);
    expect(after).not.toBeNull();
    expect((after as PersonCard).mood).toBeGreaterThan(0.6);
    expect((after as PersonCard).unhappyDays).toBe(0);
  }, 30000);

  it("opens the board at 07:00, so the morning peak is the first thing you see", () => {
    const game = newGame(citizenchoice);
    expect(game.citizenStats.clock).toBe("07:00");
  });

  it("prints a journey on the town's own clock, not in board seconds", () => {
    // ONE clock on the card. "Leaves at 07:08" and "took 1m 23s" do not
    // compose — a player cannot work out when she gets there — and board
    // seconds were only ever chosen because the day length made the in-game
    // clock nonsense. It does not any more.
    const DAY = 1800; // the shipped calibration
    expect(inGameDuration(18, DAY)).toBe("14 min"); // a local walk
    expect(inGameDuration(13, DAY)).toBe("10 min"); // a local drive
    expect(inGameDuration(105, DAY)).toBe("1h 24m"); // a city-to-city commute
    expect(inGameDuration(1800, DAY)).toBe("24h");
    expect(inGameDuration(0.1, DAY)).toBe("<1 min");
    expect(inGameDuration(Infinity, DAY)).toBe("—");

    // The raw board seconds survive as a tooltip: it is the one you can check
    // with a stopwatch, and it is what a debug session wants.
    expect(boardDuration(8)).toBe("8s");
    expect(boardDuration(83)).toBe("1m 23s");
    expect(boardDuration(Infinity)).toBe("—");
  });

  it("binds the day length, so a view never has to know it", () => {
    const fast = newGame(citizenchoice, { secPerDay: 300 });
    const shipped = newGame(citizenchoice);
    // The same board seconds mean six times as much of a 300s day as of an
    // 1800s one — which is exactly why the label cannot be a free function.
    expect(fast.durationLabel(105)).toBe("8h 24m");
    expect(shipped.durationLabel(105)).toBe("1h 24m");
  });
});
