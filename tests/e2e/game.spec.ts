import { test, expect, Page } from "@playwright/test";

test.describe("Train game", () => {
  test("boots, renders the level and runs trains without console errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => consoleErrors.push(err.message));

    await page.goto("/");

    // The 7x6 grid has 41 tiles (one cell is intentionally empty); this includes
    // the road-only feeder tile below the level crossing.
    await expect(page.locator(".tile")).toHaveCount(41);

    // Both trains (the locomotives) are rendered.
    const locomotives = page.locator(".train-locomotive");
    await expect(locomotives).toHaveCount(2);

    // At least one intersection switch and one depot are present.
    await expect(page.locator(".switch-box").first()).toBeVisible();
    await expect(page.locator(".depot-building").first()).toBeVisible();

    // The train should physically leave its depot: GSAP writes an inline
    // transform with a pixel translate (translate3d/matrix while moving) once
    // movement starts.
    const train1 = page.locator("#train1");
    await expect
      .poll(async () => train1.evaluate(el => (el as HTMLElement).style.transform), {
        timeout: 10000,
      })
      .toMatch(/translate3d\(|matrix\(|\d+px/);

    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("trains advance tile to tile under the simulation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".train-locomotive")).toHaveCount(2);

    // Plain `/` opens the DEFAULT mode (puzzle), which shows a Ready screen —
    // and the world is held still until it is answered. This assertion is about
    // the simulation moving trains, not about them moving before the player has
    // started, so press Start first. It used to pass without this only because
    // trains drove off behind the overlay, which also meant any delivery made
    // before Start went uncounted and the level could never be won.
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Read each train's tile coordinate straight from the live simulation.
    const readPositions = () =>
      page.evaluate(() => {
        const game = (window as any).__game;
        const ids = Object.keys(game.sim.trains);
        return Object.fromEntries(
          ids.map(id => [id, game.sim.trainTileId(id)])
        ) as Record<string, string>;
      });

    const start = await readPositions();

    // Tile-to-tile movement is driven by the depot-exit animation's onComplete
    // callback. If the GSAP timeline is stored in reactive (proxied) state the
    // callback never fires and the train stays on its starting tile forever.
    await expect
      .poll(
        async () => {
          const now = await readPositions();
          return Object.keys(start).some(id => now[id] !== start[id]);
        },
        { timeout: 15000, intervals: [500] }
      )
      .toBe(true);
  });

  test("no two trains ever occupy the same tile (path reservation)", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".train-locomotive")).toHaveCount(2);

    const headTiles = () =>
      page.evaluate(() => {
        const game = (window as any).__game;
        return Object.keys(game.sim.trains).map((id: string) =>
          game.sim.trainTileId(id)
        ) as string[];
      });

    // Sample repeatedly while the game runs: the two trains must never share a
    // tile (reservation protects the path through junctions).
    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(300);
      const tiles = await headTiles();
      expect(new Set(tiles).size).toBe(tiles.length);
    }
  });

  test("puzzle mode: a start overlay leads to a win overlay when all trains arrive", async ({
    page,
  }) => {
    test.setTimeout(60000);
    // A small, deterministic puzzle board: one train drives straight to its
    // matching depot and delivers itself (no switching needed).
    await page.goto("/#/play?mode=puzzle&board=objectives");

    // Puzzle mode gates play behind a start overlay.
    const start = page.getByRole("button", { name: "Start" });
    await expect(start).toBeVisible();
    await start.click();

    // Run fast and let the deterministic sim deliver the train.
    await page.evaluate(() => {
      (window as any).__game.speed.value = 4;
    });

    await expect
      .poll(() => page.evaluate(() => (window as any).__game.objective.phase), {
        timeout: 45000,
        intervals: [500],
      })
      .toBe("won");

    await expect(page.getByText("You win!")).toBeVisible();
  });

  test("the game-mode picker switches modes by clicking a card", async ({
    page,
  }) => {
    await page.goto("/#/play?mode=puzzle");
    // Open the game-mode picker from the start overlay.
    await page.getByRole("button", { name: "Change game mode" }).click();
    await expect(page.locator(".picker-card")).toBeVisible();
    // The picker shows a card per registered mode; pick Time Attack.
    await page.getByRole("button", { name: /Time Attack/ }).click();
    // The view remounts on the new mode (router-view keyed on the query).
    await expect.poll(() => page.url()).toContain("mode=time-attack");
    await expect(
      page.locator(".overlay-title", { hasText: "Time Attack / Rush" })
    ).toBeVisible();
  });

  test("remembers the last selected game mode on a plain /play", async ({
    page,
  }) => {
    // Pick a non-default mode explicitly...
    await page.goto("/#/play?mode=time-attack");
    await expect(
      page.locator(".overlay-title", { hasText: "Time Attack / Rush" })
    ).toBeVisible();
    // ...then open /play with no mode query: it should reopen Time Attack.
    await page.goto("/#/play");
    await expect(
      page.locator(".overlay-title", { hasText: "Time Attack / Rush" })
    ).toBeVisible();
  });

  test("time attack injects scheduled trains over time (test scenario)", async ({
    page,
  }) => {
    test.setTimeout(60000);
    // The /test/timeattack scenario runs in Time Attack mode: t1 is present at
    // start, t2 and t3 are injected by the schedule at 3s and 6s.
    await page.goto("/#/test/timeattack");
    const liveTrainCount = () =>
      page.evaluate(
        () => Object.keys((window as any).__game.sim.trains).length
      );
    // Only the init train is in the sim at first.
    await expect.poll(liveTrainCount, { timeout: 5000 }).toBe(1);
    // Run fast and let the schedule inject the other two.
    await page.evaluate(() => {
      (window as any).__game.speed.value = 4;
    });
    await expect
      .poll(liveTrainCount, { timeout: 45000, intervals: [300] })
      .toBe(3);
  });

  test("tycoon: a train waits, its fare decays, dispatching it pays out", async ({
    page,
  }) => {
    test.setTimeout(60000);
    // The /test/dispatch scenario runs in Tycoon mode: two trains, both waiting
    // in their stations with a fare pin over them. This is the one check that
    // covers the WHOLE wiring — sim state, decaying fare, click, settlement,
    // ledger — which the unit tests only cover a piece at a time.
    await page.goto("/#/test/dispatch");

    const snapshot = () =>
      page.evaluate(() => {
        const game = (window as any).__game;
        return {
          states: Object.keys(game.sim.trains).map((id: string) =>
            game.sim.trainState(id)
          ) as string[],
          balance: game.money.balance as number,
          fares: game.fareBadges.map((b: { amount: number }) => b.amount),
        };
      });

    // Both trains sit in their depots with a pin each.
    await expect.poll(() => page.locator(".fare-pin").count()).toBe(2);
    const first = await snapshot();
    expect(first.states).toEqual(["waiting", "waiting"]);

    // The fare falls while the train WAITS — the whole point of the mode.
    await page.evaluate(() => {
      (window as any).__game.speed.value = 4;
    });
    await expect
      .poll(async () => (await snapshot()).fares[0], { timeout: 20000 })
      .toBeLessThan(first.fares[0]);

    // Clicking a pin sends that train, and only that train.
    await page.locator(".fare-pin").first().click();
    await expect
      .poll(async () => (await snapshot()).states.filter(s => s === "waiting").length)
      .toBe(1);

    // Delivering it banks the decayed fare.
    await expect
      .poll(async () => (await snapshot()).balance, {
        timeout: 45000,
        intervals: [500],
      })
      .toBeGreaterThan(first.balance);
  });

  test("tycoon: buy the missing link in play, then deliver across it", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => consoleErrors.push(err.message));

    // The buildgap board: a line stopping two tiles short of its station, a
    // waiting train, and the budget to close the gap. This is the whole Train
    // Valley loop — build, dispatch, switch-free run, payout — end to end.
    await page.goto("/#/play?mode=tycoon&board=buildgap");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    const balance = () =>
      page.evaluate(() => (window as any).__game.money.balance as number);
    const start = await balance();

    // Arm the build tool. The edge zones appear on every tile.
    await page.getByTestId("build-toggle").click();
    const zone = (coord: string, port: number) =>
      page.locator(`.level-tile[data-coord="${coord}"] .zone[data-port="${port}"]`);

    // Click the west line's open end (east edge of 2,1), then the east line's
    // facing open end (west edge of 5,1): the controller routes across the gap
    // and lays it as ONE commit. East=Right=1, West=Left=3.
    await zone("2,1", 1).click();
    await expect(zone("2,1", 1)).toHaveClass(/zone--armed/);
    await zone("5,1", 3).click();

    // Two new tiles of track at $1,000 each came out of the balance —
    // the anchor and terminus tiles already had their rails and were free.
    await expect.poll(balance).toBe(start - 2000);
    // The gap tiles exist now and render rail art.
    await expect(page.locator('.level-tile[data-coord="3,1"] .tile')).toHaveCount(1);
    await expect(page.locator('.level-tile[data-coord="4,1"] .tile')).toHaveCount(1);
    // The objective layer counted the purchase (a "buy ≥ N pieces" star reads this).
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__game.objective.counters.tilesBuilt as number
        )
      )
      .toBe(2);

    // Esc finishes the open route (the terminus tile already has its rail, so
    // nothing further is charged) and clears the finish wedge. The wedge
    // assertion is load-bearing: an Escape handler reading stale state no-ops
    // SILENTLY (it bit once — the arrow-field `this` trap), and the balance
    // alone cannot tell.
    await expect(page.locator(".zone--finish")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".zone--finish")).toHaveCount(0);
    expect(await balance()).toBe(start - 2000);
    await page.getByTestId("build-toggle").click();

    // Dispatch the waiting train; it crosses the bought track and delivers.
    await page.locator(".fare-pin").click();
    await page.evaluate(() => {
      (window as any).__game.speed.value = 4;
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).__game.objective.phase), {
        timeout: 45000,
        intervals: [500],
      })
      .toBe("won");
    // The fare landed on top of the post-build balance.
    expect(await balance()).toBeGreaterThan(start - 2000);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("tycoon: bulldoze takes back a misdrag, and pays only for what was bought", async ({
    page,
  }) => {
    test.setTimeout(90000);
    // Why this exists: with no refund and no bankruptcy state, one fumbled
    // gesture on a tight budget silently soft-locked the board into Retry.
    await page.goto("/#/play?mode=tycoon&board=buildgap");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    const balance = () =>
      page.evaluate(() => (window as any).__game.money.balance as number);
    const tilesBuilt = () =>
      page.evaluate(
        () => (window as any).__game.objective.counters.tilesBuilt as number
      );
    const budget = await balance();

    // Buy the two gap tiles.
    await page.getByTestId("build-toggle").click();
    const zone = (coord: string, port: number) =>
      page.locator(`.level-tile[data-coord="${coord}"] .zone[data-port="${port}"]`);
    await zone("2,1", 1).click();
    await zone("5,1", 3).click();
    await expect.poll(balance).toBe(budget - 2000);
    await expect.poll(tilesBuilt).toBe(2);
    await page.keyboard.press("Escape");
    await page.getByTestId("build-toggle").click();

    // Bulldoze one of them back: money returns and the rails go.
    await page.getByTestId("raze-toggle").click();
    await page.locator('.level-tile[data-coord="3,1"]').click();
    await expect.poll(balance).toBe(budget - 1000);
    await expect(page.locator('.level-tile[data-coord="3,1"] .tile')).toHaveCount(0);
    // Net, so a "buy >= N pieces" star cannot be farmed by build/bulldoze
    // cycling. (Asserted here rather than in a unit test: the counter reaches
    // the objective through the per-frame observation, which needs real frames.)
    await expect.poll(tilesBuilt).toBe(1);

    // Bulldozing AUTHORED track removes it but pays nothing — otherwise every
    // board's pre-laid rail would be a cash machine.
    const beforeAuthored = await balance();
    await page.locator('.level-tile[data-coord="1,1"]').click();
    await expect(page.locator('.level-tile[data-coord="1,1"] .tile')).toHaveCount(0);
    expect(await balance()).toBe(beforeAuthored);

    // And a depot is the level's furniture, not the player's track.
    await page.locator('.level-tile[data-coord="0,1"]').click();
    await expect(page.locator('.level-tile[data-coord="0,1"] .tile')).toHaveCount(1);
  });

  test("tycoon: a train with nowhere to go says so", async ({ page }) => {
    test.setTimeout(90000);
    // The nudge for the failure this game actually has. Collisions are
    // impossible by construction, so a jam is silent: the board just stops, and
    // without a word it reads as the game having frozen.
    //
    // This has to be an e2e. The detector runs in the rAF loop, and a hidden
    // browser pane runs no frames at all — an earlier attempt to verify it in
    // the preview "showed" three motionless trains that were merely a frozen
    // loop, proving nothing.
    await page.goto("/#/play?mode=tycoon&board=buildgap");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Send the train at the gap WITHOUT building it: it runs to the end of the
    // rails and stops there for good.
    await page.locator(".fare-pin").click();
    await page.evaluate(() => {
      (window as any).__game.speed.value = 4;
    });

    const nudge = page.getByTestId("gridlock-nudge");
    await expect(nudge).toBeVisible({ timeout: 45000 });
    // It must name the right fix: rails, not switches — flipping a switch at a
    // severed line sends the player hunting for a junction that cannot help.
    await expect(nudge).toContainText("run out of track");
    expect(
      await page.evaluate(() => (window as any).__game.gridlock.reason)
    ).toBe("dead-end");

    // And it clears once the way is open. Note WHERE the route is drawn from:
    // the stranded train is parked on 2,1, the near side of the gap, and you
    // cannot build from under a train — that tile is occupied, so the planner
    // will not start (or finish) a route there. The rescue is drawn from the
    // FAR side instead, terminating one tile short of the train: laying 4,1 and
    // 3,1 gives 3,1 a west port facing 2,1's east port, which joins the two and
    // frees the train. So the nudge's advice is followable, just not from the
    // tile the player is staring at.
    await page.getByTestId("build-toggle").click();
    const zone = (coord: string, port: number) =>
      page.locator(`.level-tile[data-coord="${coord}"] .zone[data-port="${port}"]`);
    await zone("5,1", 3).click(); // west edge of the east stub: the open end
    await zone("3,1", 3).click(); // west edge of 3,1: one tile short of the train
    await expect(nudge).toBeHidden({ timeout: 20000 });
    // Freed, not merely un-nudged: it goes on to deliver.
    await expect
      .poll(() => page.evaluate(() => (window as any).__game.objective.phase), {
        timeout: 45000,
        intervals: [500],
      })
      .toBe("won");
  });

  test("tycoon: bought track never leaks into the scenario registry", async ({
    page,
  }) => {
    test.setTimeout(90000);
    // Regression: PlayView used to hand the game the scenario registry's
    // module-level singleton, and applyEdits wrote bought track INTO it. A
    // same-document remount (browser Back, re-entering the URL — the keyed
    // router-view remounts without a reload) then landed on the mutated board
    // with a fresh balance: free track. The board must come back as authored.
    await page.goto("/#/play?mode=tycoon&board=buildgap");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const balance = () =>
      page.evaluate(() => (window as any).__game.money.balance as number);
    const start = await balance();

    await page.getByTestId("build-toggle").click();
    const zone = (coord: string, port: number) =>
      page.locator(`.level-tile[data-coord="${coord}"] .zone[data-port="${port}"]`);
    await zone("2,1", 1).click();
    await zone("5,1", 3).click();
    await expect.poll(balance).toBe(start - 2000);
    await expect(page.locator('.level-tile[data-coord="3,1"] .tile')).toHaveCount(1);

    // Same-document navigation away and back — deliberately NOT page.goto,
    // which could full-load and mask the leak by resetting module state.
    await page.evaluate(() => {
      location.hash = "#/test";
    });
    await expect(page.locator(".level-tile")).toHaveCount(0);
    await page.evaluate(() => {
      location.hash = "#/play?mode=tycoon&board=buildgap";
    });

    // Fresh mount: the gap is a gap again, and the balance is the full budget.
    await expect(
      page.getByRole("button", { name: "Start", exact: true })
    ).toBeVisible();
    await expect(page.locator('.level-tile[data-coord="3,1"] .tile')).toHaveCount(0);
    await expect(page.locator('.level-tile[data-coord="4,1"] .tile')).toHaveCount(0);
    expect(await balance()).toBe(start);
  });

  test("tycoon: lakevalley-open — build the ring, dispatch all three, win with the money accounted", async ({
    page,
  }) => {
    test.setTimeout(120000);
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => consoleErrors.push(err.message));

    // The opening state of Lake Valley: the ring's south run is missing, the
    // yellow station is severed, and the $8,000 budget buys it back. This test
    // is the whole Train Valley level-1 loop on the real board — Ready screen,
    // fares burning from Start, buying the ring and the station junction,
    // switching, dispatching all three trains, the win screen, and the ledger
    // adding up.
    await page.goto("/#/play?mode=tycoon&board=lakevalley-open");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    const balance = () =>
      page.evaluate(() => (window as any).__game.money.balance as number);
    const budget = await balance();
    expect(budget).toBe(15000);
    await expect(page.locator(".fare-pin")).toHaveCount(3);

    // The choreography below assumes the seeded 3-cycle. Assert it first so a
    // colour-assignment change fails loudly here instead of as a stuck train.
    expect(
      await page.evaluate(() => {
        const g = (window as any).__game;
        return (
          g.trainColors.blue === g.depotColors["8,2"] &&
          g.trainColors.red === g.depotColors["2,6"] &&
          g.trainColors.yellow === g.depotColors["0,2"]
        );
      })
    ).toBe(true);

    // Buy the full rebuild, gesture by gesture (7 pieces, $7,000):
    // the ring along row 5, then the station junction's two entries at 2,5.
    await page.getByTestId("build-toggle").click();
    const zone = (coord: string, port: number) =>
      page.locator(`.level-tile[data-coord="${coord}"] .zone[data-port="${port}"]`);
    await zone("2,4", 2).click(); // South=Bottom=2, West=Left=3
    await zone("6,4", 2).click(); // ring: 5 new pieces
    await expect.poll(balance).toBe(budget - 5000); // the 5-piece ring run
    await page.keyboard.press("Escape");
    await zone("3,5", 3).click();
    await zone("2,5", 2).click(); // station entry from the ring ([E,S])
    await expect.poll(balance).toBe(budget - 6000);
    await page.keyboard.press("Escape");
    await zone("2,4", 2).click();
    await zone("2,5", 2).click(); // station entry from the west side ([N,S])
    await expect.poll(balance).toBe(budget - 7000);
    await page.keyboard.press("Escape");
    expect(await balance()).toBe(budget - 7000); // Esc lays nothing chargeable
    await page.getByTestId("build-toggle").click();

    // The bought junction renders and carries merged switch arms (a junction
    // without arms would stop a train dead on it).
    await expect(page.locator('.level-tile[data-coord="2,5"] .tile')).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).__game.objective.counters.tilesBuilt as number
        )
      )
      .toBe(7);

    // Route the three trains on disjoint paths (the rebuilt ring is the
    // passing loop): blue east along the trunk, red down the east side and
    // west along the bought ring into the yellow station, yellow up the west
    // side. Arms are per entry port, so the table is static — this is the
    // switching verb, set through the same map the switch UI writes.
    await page.evaluate(() => {
      const g = (window as any).__game;
      const set = (id: string, entry: number, arm: number) => {
        if (!g.switches[id]) g.switches[id] = {};
        g.switches[id][entry] = arm;
      };
      set("2,2", 3, 1); // blue:   W -> E
      set("2,2", 2, 0); // yellow: S -> W
      set("6,2", 3, 1); // blue:   W -> E
      set("6,2", 1, 0); // red:    E -> S
      set("2,5", 1, 0); // red:    E -> S into the station
      set("2,5", 2, 1); // yellow: S -> N up the west side
    });

    // Dispatch all three by clicking their fare pins, then run fast.
    for (const pin of await page.locator(".fare-pin").all()) await pin.click();
    await page.evaluate(() => {
      (window as any).__game.speed.value = 4;
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).__game.objective.phase), {
        timeout: 90000,
        intervals: [500],
      })
      .toBe("won");
    await expect(page.getByText("You win!")).toBeVisible();

    // Money accounted: balance = budget − track + fares, and the goals read
    // the run correctly (full rebuild ⇒ Rail baron, not Under budget).
    const end = await page.evaluate(() => {
      const g = (window as any).__game;
      return {
        counters: g.objective.counters,
        stars: Object.fromEntries(
          g.objective.stars.map((s: { id: string; earned: boolean }) => [
            s.id,
            s.earned,
          ])
        ),
      };
    });
    expect(end.counters.delivered).toBe(3);
    expect(end.counters.spent).toBe(7000);
    expect(end.counters.earned).toBeGreaterThan(0);
    expect(end.counters.balance).toBe(budget - 7000 + end.counters.earned);
    expect(await balance()).toBe(end.counters.balance);
    expect(end.stars["payday"]).toBe(true);
    expect(end.stars["rail-baron"]).toBe(true);
    expect(end.stars["under-budget"]).toBe(false);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("signals are drawn and a manual hold turns a signal to Stop", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator(".signal").first()).toBeVisible();

    const result = await page.evaluate(() => {
      const game = (window as any).__game;
      const tileId = game.signalTiles[0] as string;
      const exitPort = 1; // any port; a manual hold forces Stop regardless
      game.toggleHold(tileId, exitPort);
      return { aspect: game.sim.signalAspect(tileId, exitPort) as string };
    });
    expect(result.aspect).toBe("stop");
  });
});

test.describe("Level editor", () => {
  const cell = (page: Page, coord: string) =>
    page.locator(`.editor-cell[data-coord="${coord}"]`);
  // The redesigned editor draws via triangular edge hit-zones (`.zone`), not
  // edge dots. West=Left=3, East=Right=1.
  const drawWestEast = async (page: Page, coord: string) => {
    const west = cell(page, coord).locator('.zone[data-port="3"]');
    const east = cell(page, coord).locator('.zone[data-port="1"]');
    await west.dragTo(east);
  };

  test("draws a connected line and plays it", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => consoleErrors.push(err.message));

    await page.goto("/#/editor");
    await expect(page.locator(".menu-drawer")).toBeVisible();

    // Connect tool is default: draw a horizontal rail across three cells.
    for (const c of ["1,1", "2,1", "3,1"]) await drawWestEast(page, c);
    // Cap both ends with depots.
    await page.getByRole("button", { name: "depot" }).click();
    await cell(page, "0,1").click();
    await cell(page, "4,1").click();

    // The level should validate and Play should be enabled.
    await expect(page.locator(".drawer-status")).toHaveText(/valid/);
    const play = page.getByRole("button", { name: /Play this/ });
    await expect(play).toBeEnabled();
    await play.click();

    // We land on the play view running OUR level: 5 tiles (3 track + 2 depots),
    // not the 40-tile default — proving the editor->play handoff.
    await expect(page.locator(".train-locomotive").first()).toBeVisible();
    await expect(page.locator(".tile")).toHaveCount(5);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("a drawn rail can be deleted by clicking it", async ({ page }) => {
    await page.goto("/#/editor");
    await drawWestEast(page, "2,2");
    await expect(cell(page, "2,2").locator(".tile")).toHaveCount(1);
    // In the redesigned editor, the erase tool reveals a ✕ delete handle per
    // connection; clicking it removes just that rail.
    await page.getByRole("button", { name: "erase" }).click();
    await cell(page, "2,2").locator(".del").first().click({ force: true });
    await expect(cell(page, "2,2").locator(".tile")).toHaveCount(0);
  });

  test("signal tool places a per-direction signal", async ({ page }) => {
    await page.goto("/#/editor");
    await drawWestEast(page, "2,2");
    // Anchored on the icon: a plain "signal" also substring-matches the
    // "🚥 Signalise" tool, which made this ambiguous the day that tool was added.
    await page.getByRole("button", { name: /🚦 Signal/ }).click();
    // Toggle a signal on the East edge of the straight.
    await cell(page, "2,2").locator('.zone[data-port="1"]').click();
    await expect(cell(page, "2,2").locator(".signal")).toHaveCount(1);
  });

  test("random map generates a valid playable level", async ({ page }) => {
    await page.goto("/#/editor");
    await page.getByRole("button", { name: /Random/ }).click();
    await expect(page.locator(".drawer-status")).toHaveText(/valid/);
    await expect(page.locator(".depot-building").first()).toBeVisible();
  });
});
