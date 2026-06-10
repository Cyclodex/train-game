# 05 — Signaling & routing (advanced)

We already have **Phase 1** signaling: block/route reservation (interlocking),
always-visible directional red/green signals, and a manual hold (see
`docs/signaling-design.md`). This doc collects the deferred phases and the
routing/automation ideas that grow out of them. Most of this is "depth for people
who like trains" — schedule against the objective loop (doc 01), which matters more
first.

---

## 5.1 — Train momentum & braking model ★★ (the keystone prerequisite)

**What.** Trains accelerate and decelerate instead of snapping between stopped and
full speed; a train needs *braking distance* to stop at a red.

**Why.** It's the unlock for almost everything else "realistic": distant signals,
yellow aspects, speed signaling, gradients (doc 02 §2.9), and a much nicer *feel*
(no more instant stops). `signaling-design.md` explicitly defers Phases 2–3 *because
this doesn't exist yet*.

**How it builds on what we have.** `train.speed` is already a field carried through
the sim for exactly this. Add acceleration/deceleration to `step(dt)`; the movement
gate becomes "begin braking when the stopping distance reaches the next Stop
signal," not "stop on the tile." Keep it deterministic and unit-tested (the whole
point of the headless sim).

**Effort.** L (careful, touches the core movement). **Deps.** none, but it's the
gate for 5.2–5.4 and 2.9.

---

## 5.2 — Distant / pre-signals (Vorsignal) + yellow aspects ★

**What.** A signal ahead of a main signal that warns "next signal is red — start
slowing." The `Aspect` enum already has room (`Stop`, `Proceed`, with `Caution` /
`PreliminaryCaution` planned — one enum case + one render branch each).

**Why.** Realism and readability for longer trains/faster speeds; the reason the
aspect model was built extensibly in Phase 1.

**How.** Each signal already can reference its next signal along the route (stored
in Phase 1, unused). With braking distance (5.1), a signal shows Caution when the
*next* is Stop. Render the yellow.

**Effort.** M (once 5.1 exists). **Deps.** 5.1.

---

## 5.3 — Speed signaling / speed limits ★

**What.** Proceed-slow through diverging junctions or rough track; per-tile speed
limits.

**Why.** More texture for the management/realism crowd; pairs with gradients and
bridges (slow over the rickety bridge — OpenTTD flavour).

**How.** Per-route/per-tile speed cap read by the (5.1) speed model.

**Effort.** M. **Deps.** 5.1.

---

## 5.4 — Path-based signaling (PBS) ★

**What.** Share a block when exact train paths don't actually cross, for higher
throughput at complex junctions (OpenTTD's PBS).

**Why.** Throughput at busy junctions; lets dense layouts flow. Niche but beloved by
rail-game enthusiasts.

**How.** Reserve the *specific path* through a junction rather than the whole block;
the port-pair model (which already distinguishes crossing-without-connecting)
makes "do these two paths share a tile cell?" answerable. Phase 3 in the design doc.

**Effort.** L. **Deps.** the reservation model (have it); ideally the connection
model.

---

## 5.5 — Automatic deadlock detection & resolution ★★

**What.** Detect when two+ trains have reserved toward each other on a shared
single-track block with no escape, and resolve it (back one off to a passing loop,
or refuse the reservation that would cause it).

**Why.** `signaling-design.md` names this as the known limitation — whole-block
reservation *can* deadlock today; the player must manually re-route. The sim's
global view makes automatic resolution tractable, and it removes a real frustration.

**How.** Before granting a reservation, look ahead for a head-on conflict with no
passing point; if found, deny/defer. For recovery, detect a stalled cycle and
reverse the lower-priority train to the nearest siding (needs reversing — doc 02
§2.5). Detection is easier than recovery; ship detection first (at least warn).

**Effort.** M (detect) / L (auto-resolve). **Deps.** passing loops (2.6) for
escape; reversing (2.5) for recovery.

---

## 5.6 — Player-controlled timetables / schedules ★

**What.** Assign a train an ordered list of stops with optional wait times (OpenTTD
orders / TV2 dispatch); the sim follows them. Player triggers departures, or sets a
recurring schedule.

**Why.** Turns ad-hoc routing into planned operations — the satisfying "set up a
working railway and watch it run" loop. Pairs perfectly with stations (2.4).

**How.** A per-train order list in sim state; at each station the train consults the
next order. `RouteDestinations` in `types.ts` is already a sketch of this. Pathfind
between consecutive stops.

**Effort.** M–L. **Deps.** stations (2.4); pathfinder hardening (`IMPROVEMENTS.md`
§7–8 — type and test the pathfinder first).

---

## 5.7 — Smarter auto-routing / auto-switches ★

**What.** `automaticRoutePlanning` already exists as a config flag — flesh it out:
junctions set themselves to route each train toward its goal, optionally avoiding
congestion.

**Why.** Less manual switch-flipping; lets the player focus on higher-level
decisions. Good accessibility/onboarding default.

**How.** At a junction, choose the exit that lies on the train's shortest path to
its current destination (the pathfinder already computes routes). Optionally weight
by reservation/occupancy to avoid jams.

**Effort.** M. **Deps.** the typed/tested pathfinder (`IMPROVEMENTS.md` §7–8).

---

## Discussion seed

The realism ladder (5.1 → 5.2 → 5.3 → 5.4) is *deep* but mostly invisible to a
casual player and gated behind the momentum model. **5.5 (deadlock)** and **5.7
(auto-routing)** are the two here that remove real player *friction* today and are
worth more than the realism polish. **5.6 (schedules)** only earns its keep once
stations exist and we've leaned management, not puzzle. Prioritise accordingly.
