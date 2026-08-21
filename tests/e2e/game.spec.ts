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

    // At least one intersection switch and one depot are present. (`.switch-fan`
    // replaced the old `.switch-box` three-bulb widget — see tiles/switchFan.ts.)
    await expect(page.locator(".switch-fan").first()).toBeVisible();
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

    // The Ready card names the board's three goals BEFORE the run, and none of
    // them is lit. That second assertion is the real guard: a star's predicate
    // is evaluated over zeroed counters, and "no signal was overridden" / "no
    // train went to the wrong station" both hold trivially of a run that has
    // not happened — so anything showing scored stars here would light most of
    // them before the player moved.
    const goals = page.locator('[data-testid="goal-list"] li');
    await expect(goals).toHaveCount(3);
    await expect(goals.filter({ hasText: "Hands off" })).toBeVisible();
    await expect(goals.filter({ hasText: "Perfect colours" })).toBeVisible();
    await expect(page.locator(".goal--earned")).toHaveCount(0);
    // Nor may the HUD's own pip row pre-empt it, for the same reason.
    await expect(page.locator(".score-stars")).toHaveCount(0);

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

    // The win card lists the same goals, now scored — so "what was I aiming at"
    // and "what did I get" are read in one place, in the same words.
    const wonGoals = page.locator('[data-testid="goal-list"] li');
    await expect(wonGoals).toHaveCount(3);
    await expect(page.locator(".goal--earned").first()).toBeVisible();
  });

  test("the game-mode picker switches modes by clicking a card", async ({
    page,
  }) => {
    await page.goto("/#/play?mode=puzzle");
    // Open the game-mode picker from the start overlay.
    await page.getByRole("button", { name: "Change game mode" }).click();
    await expect(page.locator(".picker-card")).toBeVisible();
    // The picker shows a card per registered mode; pick Tycoon (a mode the
    // default board can carry — Network/Citizens are disabled there, #114).
    await page.getByRole("button", { name: /Tycoon/ }).click();
    // The view remounts on the new mode (router-view keyed on the query).
    await expect.poll(() => page.url()).toContain("mode=tycoon");
    await expect(
      page.locator(".overlay-title", { hasText: "Tycoon" })
    ).toBeVisible();
  });

  test("remembers the last selected game mode on a plain /play", async ({
    page,
  }) => {
    // Pick a non-default mode explicitly...
    await page.goto("/#/play?mode=tycoon");
    await expect(
      page.locator(".overlay-title", { hasText: "Tycoon" })
    ).toBeVisible();
    // ...then open /play with no mode query: it should reopen Tycoon.
    await page.goto("/#/play");
    await expect(
      page.locator(".overlay-title", { hasText: "Tycoon" })
    ).toBeVisible();
  });

  test("the picker's Today's-challenge chip opens the daily board (#113)", async ({
    page,
  }) => {
    await page.goto("/#/play?mode=puzzle");
    await page.getByRole("button", { name: "Change game mode" }).click();
    await page.getByRole("button", { name: /Today's challenge/ }).click();
    // Daily is a board source now: the chip navigates to ?board=daily, and the
    // view runs today's generated board under the daily ruleset.
    await expect.poll(() => page.url()).toContain("board=daily");
    await expect(
      page.locator(".overlay-title", { hasText: "Daily Challenge" })
    ).toBeVisible();
  });

  test("the picker disables unfit modes and keeps the board (#114)", async ({
    page,
  }) => {
    // objectives is a 3-tile depot lane: no stations, no towns — so Network
    // and Citizens can't run there, and their cards say why.
    await page.goto("/#/play?mode=puzzle&board=objectives");
    await page.getByRole("button", { name: "Change game mode" }).click();
    // Match on the card LABEL: "network" also appears in Citizens' description.
    const cardLabelled = (label: string) =>
      page
        .locator(".mode-card")
        .filter({ has: page.locator(".mode-card__label", { hasText: label }) });
    const network = cardLabelled("Network");
    await expect(network).toBeDisabled();
    await expect(network).toContainText("Needs stations");
    await expect(cardLabelled("Citizens")).toBeDisabled();
    // Switching to a mode that fits keeps the board in the URL.
    await cardLabelled("Tycoon").click();
    await expect.poll(() => page.url()).toContain("mode=tycoon");
    await expect.poll(() => page.url()).toContain("board=objectives");
  });

  test("an unfit mode×board URL falls back to the board's own mode (#114)", async ({
    page,
  }) => {
    // Network on the station-less objectives lane can never engage; the guard
    // resolves the board's pinned mode (puzzle) instead of loading a dead game.
    await page.goto("/#/play?mode=network&board=objectives");
    await expect(
      page.locator(".overlay-title", { hasText: "Puzzle / Dispatcher" })
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
    // Second Esc (nothing pending any more) puts the tools away entirely.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("build-toggle")).toBeVisible();

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

  test("tycoon: aiming past the end of a line still grabs that line", async ({
    page,
  }) => {
    test.setTimeout(60000);
    // The reported miss: a line's end is ONE place but sits on the boundary
    // between two tiles, and the wedge you had to hit tapered to a point at the
    // tile centre — a few pixels at a fitted zoom. Overshooting by a pixel armed
    // a different anchor on the empty tile. Both halves now delegate to the same
    // open end, so either side works.
    await page.goto("/#/play?mode=tycoon&board=buildgap");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByTestId("build-toggle").click();

    // The target on the empty side is a half-tile BAND, not a tapering wedge:
    // full tile height, where the wedge collapses to a point at the centre.
    const target = page.locator('.level-tile[data-coord="3,1"] .zone[data-port="3"]');
    await expect(target).toHaveClass(/zone--open/);
    const band = await target.boundingBox();
    const tile = await page.locator('.level-tile[data-coord="3,1"]').boundingBox();
    expect(band!.height).toBeGreaterThanOrEqual(tile!.height - 1);

    // Click the EMPTY tile beyond the rails, not the rails themselves.
    await target.click();

    // It armed the line's own end at 2,1-east. (The bands give way to the
    // ordinary wedges once a gesture owns the board, so only the tile that owns
    // the rail shows the armed marker from here on.)
    await expect(
      page.locator('.level-tile[data-coord="2,1"] .zone[data-port="1"]')
    ).toHaveClass(/zone--armed/);

    // Finish the route from there to prove the delegated anchor really builds.
    await page.locator('.level-tile[data-coord="5,1"] .zone[data-port="3"]').click();
    await expect(page.locator('.level-tile[data-coord="3,1"] .tile')).toHaveCount(1);
    await expect(page.locator('.level-tile[data-coord="4,1"] .tile')).toHaveCount(1);
  });

  test("tycoon: Build and Bulldoze are never both armed", async ({ page }) => {
    // They are opposite verbs claiming the same left click, so two armed at
    // once means a tile click has two meanings. In the dock they are
    // CATEGORIES, and a category switch re-arms — so the proof that Build is
    // really off while Bulldoze holds the click is the edge-zone overlay
    // (which exists exactly while the track tool is armed) going away.
    await page.goto("/#/play?mode=tycoon&board=buildgap");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    // Opening the dock arms the track tool: the zones own the board. (The
    // overlay is PER TILE, so presence is asserted via first(), absence via
    // count 0.)
    await page.getByTestId("build-toggle").click();
    await expect(page.getByTestId("dock-item-connect")).toHaveClass(/on/);
    await expect(page.locator(".build-overlay").first()).toBeVisible();

    // Build → Bulldoze: the bulldozer arms, and the build overlay is GONE.
    await page.getByTestId("dock-cat-raze").click();
    await expect(page.getByTestId("dock-item-raze")).toHaveClass(/on/);
    await expect(page.locator(".build-overlay")).toHaveCount(0);

    // Bulldoze → Build: the direction that was broken in the pill era.
    await page.getByTestId("dock-cat-rail").click();
    await expect(page.getByTestId("dock-item-connect")).toHaveClass(/on/);
    await expect(page.locator(".build-overlay").first()).toBeVisible();

    // ✕ puts the tools away: no dock, no armed verb, the handle is back.
    await page.getByTestId("build-dock-close").click();
    await expect(page.locator(".build-overlay")).toHaveCount(0);
    await expect(page.getByTestId("dock-item-connect")).toHaveCount(0);
    await expect(page.getByTestId("build-toggle")).toBeVisible();
  });

  test("tycoon: undo takes back a misdrag free, bulldoze charges to clear", async ({
    page,
  }) => {
    test.setTimeout(90000);
    // The two verbs, through the real UI, in the one place their difference is
    // visible. They used to be one button that refunded in full — which meant
    // demolition paid you, because it had to double as the escape hatch for a
    // MISDRAG. A misdrag is an input error, so it gets an input-level answer
    // (undo), and clearing track is then free to cost what it should.
    await page.goto("/#/play?mode=tycoon&board=buildgap");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    const balance = () =>
      page.evaluate(() => (window as any).__game.money.balance as number);
    const tilesBuilt = () =>
      page.evaluate(
        () => (window as any).__game.objective.counters.tilesBuilt as number
      );
    const budget = await balance();

    const zone = (coord: string, port: number) =>
      page.locator(`.level-tile[data-coord="${coord}"] .zone[data-port="${port}"]`);
    const buyTheGap = async () => {
      await page.getByTestId("build-toggle").click();
      await zone("2,1", 1).click();
      await zone("5,1", 3).click();
      await expect.poll(balance).toBe(budget - 2000);
      await page.keyboard.press("Escape"); // finish the open route…
      await page.keyboard.press("Escape"); // …and put the tools away
      await expect(page.getByTestId("build-toggle")).toBeVisible();
    };

    // --- undo: the whole purchase comes back, and costs nothing -------------
    await buyTheGap();
    await expect.poll(tilesBuilt).toBe(2);
    const undo = page.getByTestId("undo-build");
    await expect(undo).toBeVisible();
    await expect(undo).toContainText("$2,000");
    await undo.click();
    expect(await balance()).toBe(budget); // every penny, no fee
    await expect(page.locator('.level-tile[data-coord="3,1"] .tile')).toHaveCount(0);
    await expect(page.locator('.level-tile[data-coord="4,1"] .tile')).toHaveCount(0);
    // And it un-counts the purchase — a fumbled drag costs no goal either.
    await expect.poll(tilesBuilt).toBe(0);
    // Nothing left to take back, so the control goes away rather than sitting
    // there as a dead button.
    await expect(undo).toHaveCount(0);

    // --- bulldoze: clearing track COSTS, and never pays back ----------------
    await buyTheGap();
    const afterBuild = await balance();
    // The bulldozer lives in the dock: open it, then arm the raze category.
    await page.getByTestId("build-toggle").click();
    await page.getByTestId("dock-cat-raze").click();
    await page.locator('.level-tile[data-coord="3,1"]').click();
    await expect.poll(balance).toBe(afterBuild - 300); // the demolition fee
    await expect(page.locator('.level-tile[data-coord="3,1"] .tile')).toHaveCount(0);
    // Net, so a "buy >= N pieces" star cannot be farmed by build/raze cycling.
    // (Asserted here rather than in a unit test: the counter reaches the
    // objective through the per-frame observation, which needs real frames.)
    await expect.poll(tilesBuilt).toBe(1);
    // Razing also ends the undo window — the layout is no longer the one bought.
    await expect(undo).toHaveCount(0);

    // AUTHORED track costs the same to clear. The old rule was "only what you
    // bought pays back", to stop pre-laid rail becoming a cash machine; with a
    // fee instead of a refund that exploit is gone by construction, so the
    // price can simply be uniform.
    const beforeAuthored = await balance();
    await page.locator('.level-tile[data-coord="1,1"]').click();
    await expect(page.locator('.level-tile[data-coord="1,1"] .tile')).toHaveCount(0);
    expect(await balance()).toBe(beforeAuthored - 300);

    // And a depot is the level's furniture, not the player's track.
    await page.locator('.level-tile[data-coord="0,1"]').click();
    await expect(page.locator('.level-tile[data-coord="0,1"] .tile')).toHaveCount(1);
  });

  test("tycoon: sending a train closes the undo window", async ({ page }) => {
    test.setTimeout(60000);
    // The rule that stops undo being a full-refund bulldoze in disguise. It is
    // not a timer — a window that closes on its own would be invisible — it
    // closes on what the PLAYER does, and putting the railway into service is
    // the clearest of those.
    await page.goto("/#/play?mode=tycoon&board=buildgap");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByTestId("build-toggle").click();
    await page
      .locator('.level-tile[data-coord="2,1"] .zone[data-port="1"]')
      .click();
    await page
      .locator('.level-tile[data-coord="5,1"] .zone[data-port="3"]')
      .click();
    await page.keyboard.press("Escape"); // finish the open route…
    await page.keyboard.press("Escape"); // …and put the tools away

    await expect(page.getByTestId("undo-build")).toBeVisible();
    await page.locator(".fare-pin").click(); // send the train
    await expect(page.getByTestId("undo-build")).toHaveCount(0);
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

  test("tycoon: the calendar turns and the railway is taxed for what you laid", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => consoleErrors.push(err.message));

    // The second clock through the real UI (design doc §1.3). Everything about
    // the levy is pure and unit-tested in `tax.spec.ts`; what only a browser
    // can prove is that it is WIRED — that the frame loop runs it, that the
    // Ready card holds it, and that the HUD says so. A hidden pane runs no
    // requestAnimationFrame, so this cannot be checked by poking the preview.
    await page.goto("/#/play?mode=tycoon&board=taxyear");
    const money = () =>
      page.evaluate(() => {
        const m = (window as any).__game.money;
        return {
          balance: m.balance as number,
          taxPaid: m.taxPaid as number,
          taxPerYear: m.taxPerYear as number,
          dateLabel: m.dateLabel as string,
        };
      });

    // Behind the Ready card nothing accrues — the scored clock is frozen there
    // and the levy is denominated in it.
    await expect(page.locator(".score-calendar")).toContainText("Jan 1830");
    await page.waitForTimeout(1500);
    expect((await money()).dateLabel).toBe("Jan 1830");

    await page.getByRole("button", { name: "Start", exact: true }).click();
    const budget = (await money()).balance;

    // Nothing laid yet, so nothing owed: only PLAYER-built track is taxed, and
    // the board's own line is the company's existing one.
    expect((await money()).taxPerYear).toBe(0);

    // Close the gap: two tiles at $1,000, and the upkeep line jumps to $600/yr.
    await page.getByTestId("build-toggle").click();
    const zone = (coord: string, port: number) =>
      page.locator(`.level-tile[data-coord="${coord}"] .zone[data-port="${port}"]`);
    await zone("1,1", 1).click(); // East=Right=1
    await zone("4,1", 3).click(); // West=Left=3
    await expect.poll(async () => (await money()).taxPerYear).toBe(600);
    await expect(page.locator(".score-calendar")).toContainText("$600/yr");
    await page.keyboard.press("Escape"); // finish the open route…
    await page.keyboard.press("Escape"); // …and put the tools away

    // A year here lasts 10 sim-seconds; run at 4x and watch one turn. The
    // balance steps down by exactly the annual figure, and the date follows.
    await page.evaluate(() => {
      (window as any).__game.speed.value = 4;
    });
    await expect
      .poll(async () => (await money()).taxPaid, {
        timeout: 30000,
        intervals: [250],
      })
      .toBeGreaterThan(0);
    const after = await money();
    // Whole levies only, of $600 each — never a fractional trickle.
    expect(after.taxPaid % 600).toBe(0);
    expect(after.balance).toBe(budget - 2000 - after.taxPaid);
    expect(after.dateLabel).not.toBe("Jan 1830");
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("tycoon: an unpayable levy folds the railway, and Retry gives it back", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => consoleErrors.push(err.message));

    // Bankruptcy through the real UI. The rule itself is pure and covered in
    // `bankruptcy.spec.ts`; what only a browser proves is that the frame loop
    // runs it, that the HUD warns BEFORE the bill lands, and that the Failed
    // overlay is a real exit rather than a dead board.
    await page.goto("/#/play?mode=tycoon&board=bankrupt");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    const money = () =>
      page.evaluate(() => {
        const m = (window as any).__game.money;
        return { balance: m.balance as number, unpaid: m.unpaidTax as number };
      });
    const budget = (await money()).balance;
    expect(budget).toBe(6000);

    // Close the gap: $2,000 of track, and $1,200 a year to hold it.
    await page.getByTestId("build-toggle").click();
    const zone = (coord: string, port: number) =>
      page.locator(`.level-tile[data-coord="${coord}"] .zone[data-port="${port}"]`);
    await zone("1,1", 1).click();
    await zone("4,1", 3).click();
    await expect.poll(async () => (await money()).balance).toBe(budget - 2000);
    await page.keyboard.press("Escape"); // finish the open route…
    await page.keyboard.press("Escape"); // …and put the tools away
    await expect(page.locator(".score-calendar")).toContainText("$1,200/yr");
    // Not in trouble yet — $3,000 covers the next bill comfortably.
    await expect(page.locator(".score-calendar")).not.toHaveClass(/--broke/);

    // Leave the train on the platform and let the years turn.
    await page.evaluate(() => {
      (window as any).__game.speed.value = 4;
    });

    // The warning comes FIRST, while bulldozing could still save the run. That
    // ordering is the feature: a Failed screen with no warning is an ambush.
    await expect(page.locator(".score-calendar")).toHaveClass(/--broke/, {
      timeout: 30000,
    });
    await expect(page.locator(".score-tax-warn")).toBeVisible();
    expect((await money()).unpaid).toBe(0); // warned, not yet folded

    // Then the bill it cannot pay.
    await expect(page.getByText("Failed")).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".overlay-desc")).toContainText("Bankrupt");
    await expect(page.locator(".overlay-desc")).toContainText("Deliver sooner");
    const broke = await money();
    expect(broke.balance).toBe(0);
    expect(broke.unpaid).toBeGreaterThan(0);

    // Retry is a true do-over: the purse, the calendar and the gap all return.
    // (It resets and starts in one go — no second Ready card.)
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.getByText("Failed")).toHaveCount(0);
    expect(await money()).toEqual({ balance: budget, unpaid: 0 });
    await expect(page.locator(".score-calendar")).toContainText("1830");
    await expect(page.locator(".score-calendar")).not.toHaveClass(/--broke/);
    await expect(page.locator('.level-tile[data-coord="2,1"] .tile')).toHaveCount(0);
    // Nothing was bought this run, so the levy is $0 and the clock is harmless.
    await expect(page.locator(".score-calendar")).toContainText("$0/yr");
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
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
    // What went on TRACK, which is what the build gestures below are about.
    // The raw balance is no longer a stable measure of a purchase on this
    // board: the annual levy comes out of the same pool on its own schedule,
    // so a `balance === budget − 5000` assertion would pass or fail on whether
    // an in-game year happened to turn during the click.
    const trackSpent = () =>
      page.evaluate(() => (window as any).__game.money.trackSpent as number);
    const budget = await balance();
    expect(budget).toBe(15000);
    await expect(page.locator(".fare-pin")).toHaveCount(3);

    // The second clock is on this board: a date, not a stopwatch, and no
    // upkeep yet because nothing has been laid (only player-built track is
    // taxed).
    await expect(page.locator(".score-calendar")).toContainText("1830");
    await expect(page.locator(".score-calendar")).toContainText("$0/yr");

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
    await expect.poll(trackSpent).toBe(5000); // the 5-piece ring run
    await page.keyboard.press("Escape");
    await zone("3,5", 3).click();
    await zone("2,5", 2).click(); // station entry from the ring ([E,S])
    await expect.poll(trackSpent).toBe(6000);
    await page.keyboard.press("Escape");
    await zone("2,4", 2).click();
    await zone("2,5", 2).click(); // station entry from the west side ([N,S])
    await expect.poll(trackSpent).toBe(7000);
    await page.keyboard.press("Escape");
    expect(await trackSpent()).toBe(7000); // Esc lays nothing chargeable
    // The railway now costs something to hold: 7 pieces at $150 a year.
    await expect(page.locator(".score-calendar")).toContainText("$1,050/yr");
    await page.keyboard.press("Escape"); // nothing pending: puts the tools away

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
        // Read in the SAME evaluate as the counters: the ledger stops moving
        // once the phase leaves "playing", but reading the two across separate
        // round trips is a race waiting to be introduced.
        taxPaid: g.money.taxPaid as number,
        stars: Object.fromEntries(
          g.objective.stars.map((s: { id: string; earned: boolean }) => [
            s.id,
            s.earned,
          ])
        ),
      };
    });
    const tax = end.taxPaid;
    expect(end.counters.delivered).toBe(3);
    // Track and upkeep are both outgoings, and `spent` is all of them — but
    // only `trackSpent` is the build, which is what the Under budget goal
    // scores. Splitting them is what stops a goal about BUILDING quietly
    // becoming a goal about TIME.
    expect(end.counters.trackSpent).toBe(7000);
    expect(end.counters.spent).toBe(7000 + tax);
    // The run spans 2-3 in-game years, so the levy actually landed: a tax you
    // never pay is not a clock.
    expect(tax).toBeGreaterThan(0);
    expect(end.counters.earned).toBeGreaterThan(0);
    expect(end.counters.balance).toBe(
      budget - 7000 - tax + end.counters.earned
    );
    expect(await balance()).toBe(end.counters.balance);
    // The full rebuild is still comfortably affordable with the tax on top —
    // the budget steers with goals, not scarcity.
    expect(end.counters.balance).toBeGreaterThan(0);
    expect(end.stars["payday"]).toBe(true);
    expect(end.stars["rail-baron"]).toBe(true);
    expect(end.stars["under-budget"]).toBe(false);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("tycoon: a train that ran out of track can be rescued from the tile it is stuck on", async ({
    page,
  }) => {
    test.setTimeout(120000);
    // Reported from a real game. Buy the RING only (5 pieces) and skip the
    // yellow station's entry: the train standing in that station leaves it,
    // steps onto 2,5 — which now has [N,E] and no southern connection — and
    // strands there, directly above its own depot. The big station sprite
    // underneath makes it look docked, which is how it gets reported as "went
    // into the depot but did not count".
    //
    // The rescue is to lay 2,5's missing link. That is the very tile the
    // stranded train is standing on, and "you cannot build where a train is"
    // used to refuse it outright, leaving the board unwinnable from the side
    // the player is looking at.
    await page.goto("/#/play?mode=tycoon&board=lakevalley-open");
    await page.getByRole("button", { name: "Start", exact: true }).click();

    const zone = (coord: string, port: number) =>
      page.locator(`.level-tile[data-coord="${coord}"] .zone[data-port="${port}"]`);
    const trackSpent = () =>
      page.evaluate(() => (window as any).__game.money.trackSpent as number);

    // The ring, and nothing else.
    await page.getByTestId("build-toggle").click();
    await zone("2,4", 2).click();
    await zone("6,4", 2).click();
    await expect.poll(trackSpent).toBe(5000);
    await page.keyboard.press("Escape"); // finish the open route…
    await page.keyboard.press("Escape"); // …and put the tools away

    // Send everything, then let the trap spring.
    const pins = page.locator(".fare-pin");
    for (let i = 0, n = await pins.count(); i < n; i++) {
      await pins.nth(i).click({ force: true, timeout: 2000 }).catch(() => {});
    }
    await page.evaluate(() => {
      (window as any).__game.speed.value = 4;
    });

    await expect
      .poll(
        () =>
          page.evaluate(
            () => ((window as any).__game.sim.strandedOn("2,5") as string[]).length
          ),
        { timeout: 30000, intervals: [400] }
      )
      .toBeGreaterThan(0);

    // The tile is occupied, and editable anyway — that is the whole fix.
    expect(
      await page.evaluate(() => !!(window as any).__game.occupied["2,5"])
    ).toBe(true);
    expect(
      await page.evaluate(() => (window as any).__game.canEdit(["2,5"]))
    ).toBe(true);

    // Lay the missing link under it.
    await page.getByTestId("build-toggle").click();
    await zone("3,5", 3).click();
    await zone("2,5", 2).click();
    await expect.poll(trackSpent).toBe(6000);
    await page.keyboard.press("Escape"); // finish the open route…
    await page.keyboard.press("Escape"); // …and put the tools away

    // And it goes: nobody is stranded on 2,5 any more, and the train has left.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => ((window as any).__game.sim.strandedOn("2,5") as string[]).length
          ),
        { timeout: 30000, intervals: [400] }
      )
      .toBe(0);
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
    // Cap both ends with depots. Depot lives on Rail → Stations in the
    // three-row dock, so open that tab first.
    await page.getByRole("button", { name: "Stations" }).click();
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
    // The bulldozer category reveals a ✕ delete handle per connection (its
    // default filter is Everything); clicking it removes just that rail.
    await page.getByRole("button", { name: "Bulldozer" }).click();
    await cell(page, "2,2").locator(".del").first().click({ force: true });
    await expect(cell(page, "2,2").locator(".tile")).toHaveCount(0);
  });

  test("signal tool places a per-direction signal", async ({ page }) => {
    await page.goto("/#/editor");
    await drawWestEast(page, "2,2");
    // Signal lives on Rail → Signalling; opening the tab arms its first item,
    // which IS the signal tool.
    await page.getByRole("button", { name: "Signalling" }).click();
    await page.getByRole("button", { name: /🚦 Signal/ }).click();
    // Toggle a signal on the East edge of the straight.
    await cell(page, "2,2").locator('.zone[data-port="1"]').click();
    await expect(cell(page, "2,2").locator(".signal")).toHaveCount(1);
  });

  // Starting is the USER's call: the editor no longer refuses to hand a board
  // over because it has no depot pair or trips a validation rule. A stub of
  // track with nothing on it is a perfectly good thing to go and look at.
  test("plays a board with no depots at all", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", err => consoleErrors.push(err.message));

    await page.goto("/#/editor");
    for (const c of ["1,1", "2,1", "3,1"]) await drawWestEast(page, c);
    // Dangling ends, no depots — the drawer says so, and Play still works.
    await expect(page.locator(".drawer-status")).not.toHaveText(/depots/);
    const play = page.getByRole("button", { name: /Play this/ });
    await expect(play).toBeEnabled();
    await play.click();

    // Our three tiles, and no trains — the board is the point, not the run.
    await expect(page.locator(".tile")).toHaveCount(3);
    await expect(page.locator(".train-locomotive")).toHaveCount(0);
    expect(consoleErrors, consoleErrors.join("\n")).toEqual([]);
  });

  test("random map generates a valid playable level", async ({ page }) => {
    await page.goto("/#/editor");
    await page.getByRole("button", { name: /Random/ }).click();
    await expect(page.locator(".drawer-status")).toHaveText(/valid/);
    await expect(page.locator(".depot-building").first()).toBeVisible();
  });
});
