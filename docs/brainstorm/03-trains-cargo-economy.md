# 03 — Trains, cargo & economy

Today trains are uniform: a loco + wagons that pathfind depot→depot, with a colour
that either matches the destination or doesn't. This doc is about giving trains and
their loads *meaning* — variety, cargo, demand, and (optionally) money. This is the
"management game" axis; how far we go depends on the puzzle-vs-management fork in
`99-open-questions.md`.

---

## 3.1 — Train & locomotive variety ★★

**What.** More than `people` / `fraight`: different locos with different
**speed**, **capacity**, **acceleration**, **length** (number of wagons), maybe
**price**. Steam → diesel → electric flavour, or just "fast/light" vs
"slow/heavy."

**Why.** Variety creates decisions: the fast loco for the tight deadline, the
heavy hauler for bulk. Also pure visual delight (different sprites).

**How it builds on what we have.** `TrainObject` already carries `type` and
`wagons[]`; `train.speed` is already a field the sim respects (kept for the future
braking model — see `signaling-design.md`). Add a small loco-stats table and read
speed/capacity from it. Variable speed plugs into the deferred Phase-2 momentum
model; even before that, a constant per-loco speed is trivial.

**Effort.** S–M. **Deps.** none for constant speed; full accel needs Phase-2.

---

## 3.2 — Variable train length & wagon management ★

**What.** Trains of different lengths; couple/uncouple wagons; longer = more
capacity but slower, needs longer platforms (ties to 2.4) and longer blocks.

**Why.** A classic rail-puzzle lever (Railbound is literally about ordering
carriages). Length interacting with platform/block length is rich.

**How.** `wagons[]` length already varies; `App.vue` even has a six-wagon train
ready. The sim samples body occupancy per wagon, so length mostly works — the new
parts are platform-fit checks and length-aware reservation. Coupling/uncoupling is
a bigger sim feature (Railbound-style), probably later.

**Effort.** M (length effects) / L (dynamic coupling). **Deps.** stations (2.4) for
platform-fit to matter.

---

## 3.3 — Cargo types & matching (beyond colour) ★★

**What.** Generalise "colour match" into **cargo types**: a depot/station *demands*
a type (coal, passengers, timber, mail…); a train *carries* a type; a delivery
counts only on a type match. Colour can stay as the visual encoding.

**Why.** It's the same satisfying matching loop we have, but legible and
extensible — and the on-ramp to production chains (3.5). Turns random-colour luck
(today's weakness, per `IMPROVEMENTS.md`) into *designed*, solvable demand.

**How.** Replace/augment `trainColor` matching with a `cargo` enum on trains and a
`demand` on depots/stations. The delivery predicate (already exists) checks type
instead of/with colour. Minimal sim change; mostly data + UI icons.

**Effort.** S–M. **Deps.** none; complements 1.1 objectives.

---

## 3.4 — Passengers / cargo as spawning demand ★★★ (Endless engine)

**What.** Sources periodically **spawn** waiting units (passengers as shapes, cargo
as icons) that accumulate until a matching train picks them up and delivers them.
Demand rises over time.

**Why.** This is the Mini Metro / OpenTTD heartbeat and the engine behind Endless
mode (1.4) and overflow-failure tension (1.6). It's what makes a *living* network
instead of a fixed puzzle.

**How.** A spawner in the sim (deterministic, seedable) adds to per-source queues on
a cadence. Stations (2.4) hold the queues; trains load on dwell. Renderer draws
queue size as waiting sprites. Keep it in the headless sim so it stays testable.

**Effort.** M–L. **Deps.** stations (2.4) ideally; objective/overflow layer (1.1,
1.6).

---

## 3.5 — Production chains ★ (Train Valley 2 model)

**What.** Industries transform cargo: logs → boards, boards + glass → furniture;
cities demand the finished good. You must route intermediates through the network in
order.

**Why.** Deep, replayable logistics puzzles — TV2's whole identity. But it's a big
content + systems investment and a real genre commitment.

**How.** Cargo (3.3) + stations (2.4) + a per-industry recipe table and inventory.
Substantial. Only worth it if we commit to the management fantasy.

**Effort.** L+. **Deps.** 3.3, 3.4, 2.4, economy (3.6). **Flag:** decide the
fantasy first (`99-open-questions.md`) before investing here.

---

## 3.6 — Money / economy ★

**What.** Deliveries pay (further = more, à la OpenTTD); spend on track, clearing
terrain (2.8), bridges/tunnels, new trains, upgrades. Optional running costs.

**Why.** A resource to optimise; gives terrain-clearing and loco choice real
trade-offs; classic tycoon loop.

**How.** A money counter in the objective/game-state layer; build actions debit it;
delivery events credit it (amount = distance/type). Doesn't touch the sim core.

**Effort.** M. **Deps.** 1.1 game-state layer; pairs with editor build actions.

---

## 3.7 — Upgrades / unlocks (Mini Metro weekly choice) ★★

**What.** Between levels (or "every Sunday" in Endless) pick one upgrade: +1 train,
+capacity, +a line/route, a bridge, a tunnel, faster loco.

**Why.** Player-authored progression; meaningful choices; a light meta-loop. Cheap
relative to its retention payoff.

**How.** An upgrade pool + a pick-one modal driven by the game-state layer; each
upgrade flips a flag/stat the sim or palette reads.

**Effort.** M. **Deps.** 1.1/1.2; whichever upgrades reference (trains, bridges…).

---

## 3.8 — Train health / maintenance, breakdowns ★ (optional realism)

**What.** Trains age / can break down and block a line until cleared; maintenance
depots restore them.

**Why.** Adds unpredictability and a use for depots beyond delivery. Risk: can feel
like busywork — Mini Metro deliberately omits it.

**How.** A per-train condition stat decremented over distance; breakdown = a stalled
occupancy on a tile (reuses the blocking machinery). Optional, probably late.

**Effort.** M. **Deps.** depots-as-service; economy for repair cost.

---

## Discussion seeds

- The cheapest meaningful upgrade here is **3.3 (typed cargo) + 3.7 (pick-an-
  upgrade)** — both small, both directly fix the "matching is random luck" weakness
  and add progression, neither requires committing to the full management genre.
- **3.4 (spawning demand)** is the gateway to the whole Endless/management
  direction. It's the highest-value *and* most genre-defining choice — discuss
  before building.
- Production chains (3.5) and deep economy are a fork in identity, not just a
  feature. Don't drift into them by accident.
