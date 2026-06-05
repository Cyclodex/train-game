# 02 — Terrain & tile types (the headline doc)

This is the doc the prompt was really about: **tunnels, bridges, level crossings
(Bahnübergänge), stations**, and **obstacles / terrain** (forest, water, hills,
rock). Treat each as a candidate "world" in a Railbound-style campaign — each
teaches one idea.

**Architectural through-line.** On the data-driven branch a cell is
`{ connections: PortPair[], role?, signals? }`, with kind/rail-geometry/sim-routing
all *derived* from connections. Most features below are **a new `role` plus a
derived render layer and (sometimes) a sim rule** — not a new bespoke component.
That's why merging that branch first makes this whole doc cheap. Where a feature
needs genuinely new sim behaviour, it's called out.

A useful mental split:
- **Track features** that change how trains move (tunnel, bridge, crossing,
  station) → touch the sim.
- **Terrain / obstacles** that constrain *where track may be built* (forest,
  water, rock, hill) → mostly editor/validation + render, little or no sim.

---

## A. Track features

### 2.1 — Tunnels ★★★

**What.** Track that passes *under* an obstacle (mountain/hill) or under other
track. Visually: train enters a portal, disappears, emerges at the far portal.
Two flavours, pick deliberately:
- **Cosmetic/short** — a one-tile "covered" segment; train just renders hidden
  while inside (OpenTTD-ish portal look).
- **Teleport/warp** (Railbound) — a pair of linked portals; entering one exits the
  other elsewhere on the board. A *routing* tool, not just decoration.

**Why it's fun.** Lets track cross terrain and itself; the warp variant is a
genuine puzzle mechanic (Railbound builds whole worlds on it). Strong "ooh" factor.

**How it builds on what we have.** Cosmetic: a `tunnel` role on a straight cell +
a render flag that hides the train sprite between entry/exit ports (the sim path is
unchanged; only `Train.vue` visibility changes). Warp: model the portal pair as a
graph edge in `network.ts` — `traverse()` from portal-A's inner port yields
portal-B's outer port. The sim already routes purely on the port graph, so a
"teleport edge" is a natural extension. Reservation must treat the linked portal as
one block (don't let two trains warp into each other).

**Effort.** Cosmetic S–M; warp M–L (graph + reservation + tests). **Deps.**
data-driven model strongly recommended; warp needs a way to author the pairing
(editor).

**Open Q.** Cosmetic crossing-under (depth/layering) or true teleport? They're
different features wearing the same hat.

---

### 2.2 — Bridges / overpasses ★★★

**What.** Track that passes *over* something — a river, a road, or **another
track** — letting two lines cross without a junction (no switching, no conflict).

**Why it's fun.** Solves the "two routes must cross but shouldn't interact" problem
elegantly; removes a forced junction and its reservation conflict. The grade-
separated crossing is the satisfying "aha, just bridge over it" moment. Mini Metro
literally sells bridges as the river-crossing upgrade.

**How it builds on what we have.** This is the key insight from the connection
model: the existing port-pair design **already distinguishes a straight-only
crossing from a full junction** (that's why pairs, not edges — see the
`data-driven-tiles` memory). A bridge tile is a cell with *two independent,
non-connecting* port-pairs (N–S and E–W) at different *layers*. The sim treats
them as two non-interacting through-routes on the same cell: a train on the N–S
pair never sees the E–W pair, so **no reservation conflict** — that falls straight
out of the model. Render the over-track with a shadow/raised look and z-order.

**Effort.** M (render + the "two non-interacting pairs share a cell, don't reserve
against each other" sim rule + tests). **Deps.** data-driven model (this is almost
free *with* it, awkward without it).

**Note.** Bridge-over-track and bridge-over-water/road can share the same sim
mechanic and differ only in what's rendered underneath.

---

### 2.3 — Level crossings / Bahnübergänge ★★★

**What.** A tile where **road meets rail at grade**. Cars drive on the road; when a
train approaches, gates drop / lights flash and road traffic stops; gates lift when
the train clears. The signature tension of the genre's crossing games.

**Why it's fun.** It's a self-contained little drama on every pass, and it couples
two systems (trains + road cars from doc 04) into one readable conflict. Great
juice (flashing lights, descending boom, the *ding-ding*). Also a scoring hook:
*don't make cars wait too long*, or *never let a car be on the crossing when a
train arrives*.

**How it builds on what we have.** The crossing tile is a cell carrying **both** a
rail port-pair and a road port-pair that *physically intersect but don't connect*
(again, port-pairs make this expressible). Sim logic mirrors a signal: when a train
reserves the approaching block, the crossing enters `closed` (gate down) and the
**road occupancy gate** holds cars — exactly the reservation/occupancy machinery we
already have for trains, applied to the road lane. Render: boom barriers + Andreas
cross + flashing lights tied to the `closed` state.

**Effort.** M–L (needs road traffic to exist — doc 04 §4.1 — or a simplified
"abstract road actors" first). **Deps.** road/car actors (doc 04); reuses the
reservation model.

**Open Q.** Is the player *managing* the crossing (the crossing-game fantasy:
control the gate, score throughput) or is it *automatic* and just atmosphere? Two
very different features.

---

### 2.4 — Stations (passenger & freight) ★★★

**What.** A through-track tile (unlike a depot, which is a dead-end terminus) where
a train **stops, loads/unloads, then continues**. Passengers/cargo wait at the
station and board matching trains. Optionally multi-tile platforms (OpenTTD's
drag-to-size stations).

**Why it matters.** Stations are what turn "depot A → depot B" into a *network*.
They enable the Mini Metro / OpenTTD loop: lines that serve many stops, demand that
accumulates, throughput as a score. They're the backbone for cargo (doc 03) and
the Endless mode (doc 01).

**How it builds on what we have.** Today a depot is a terminus that parks/bounces on
colour match. A station is a `role: "station"` cell on through-track with a dwell
behaviour in the sim: train arrives → enters `Dwelling` for N ticks → loads waiting
units up to capacity → departs. `TrainStatus` already has entering/leaving-depot
states to mirror. Station holds a queue (ties to 1.6 overflow). The renderer draws a
platform + a little waiting crowd whose size = queue length.

**Effort.** L (new sim behaviour: dwell, queues, board/alight; plus render).
**Deps.** benefits hugely from cargo/passenger model (doc 03 §3.4); pairs with 1.6.

**Sub-ideas.**
- **Numbered / typed stations** (Railbound) — a train must visit stations in a
  given order, or only certain trains serve certain stations. Pure routing puzzle,
  cheap once stations exist.
- **Platform length** limits train length (long train can't fully berth) — a nice
  constraint once trains have variable length (doc 03).

---

### 2.5 — Turntables / reversers / dead-end sidings ★

**What.** A tile that lets a train reverse direction (turntable, or a stub siding it
backs out of). Lets trains turn around without a full loop.

**Why.** Opens compact puzzle layouts and shunting-style play; removes the "you must
build a loop to come back" constraint.

**How.** A sim operation that flips the train's orientation and swaps head/tail
traversal direction. Non-trivial because our trains currently only go forward along
a path; reversing means re-deriving the path backward. Probably a Phase-2+ thing.

**Effort.** L. **Deps.** train length/orientation handling; deferred.

---

### 2.6 — Multi-track main lines, passing loops, yards ★

**What.** Authoring patterns rather than new tiles: double-track main lines,
passing loops (one train waits on a siding while another passes — the deadlock
escape), and a yard of parallel sidings.

**Why.** These are *the* answers to single-track deadlock (see `signaling-design.md`
known limitation) and make the signaling actually shine.

**How.** No new tile types — just curated levels + the procgen producing them. The
signaling already supports the routing; this is content + maybe a "siding" hint in
procgen.

**Effort.** S–M (content). **Deps.** signaling (done), level authoring.

---

## B. Terrain & obstacles (where you *can't* build)

These mostly don't touch the sim — they constrain the **editor / placement /
procgen** and add visual richness. They're what make a map feel like a *place*.

### 2.7 — Obstacle tiles: forest, rock, mountain, water ★★

**What.** Non-track cells you cannot lay plain track on. Each implies its own
"answer":
- **Forest** — clearable at a cost (money/time), or just impassable scenery.
- **Rock / mountain** — pass only via **tunnel** (2.1).
- **River / lake / water** — cross only via **bridge** (2.2).
- **Hill / slope** — see elevation (2.9); affects speed/grade.

**Why it's fun.** Obstacles are what give tunnels and bridges a *reason to exist*.
A blank grid makes bridges pointless; a river makes them obvious. This is the
classic "terrain poses the question, the special tile is the answer" design.

**How it builds on what we have.** A cell gains a `terrain` field (`forest | rock |
water | plain | …`). The data-driven **validator** (`tiles/validate.ts`) already
checks legality — extend it: "can't place track role on `water` unless role is
`bridge`," "can't place on `rock` unless `tunnel`." Render a per-terrain background
layer beneath the rails. Procgen (`generate.ts`) scatters terrain first, then routes
track around/through it.

**Effort.** M. **Deps.** data-driven model + editor/validator + procgen (all on the
branch). Without that branch this is much more painful.

---

### 2.8 — Clearable terrain at a cost (economy hook) ★

**What.** Forest/rock can be removed by spending money/time before you can build —
OpenTTD-style terraforming-lite.

**Why.** Gives the economy (doc 03) a sink and makes routing a cost trade-off
(go around the forest, or pay to clear it?).

**How.** An editor/build action that flips `terrain: forest → plain` for a price;
needs the money system (doc 03 §3.6). In a puzzle mode, instead of money it could
cost from a limited "clear" budget.

**Effort.** S (once economy exists). **Deps.** 3.6 economy or a budget counter.

---

### 2.9 — Elevation / hills / gradients ★ (ambitious)

**What.** Tiles have a height; track climbs/descends. Steep gradients slow trains
(esp. heavy/long ones); bridges and tunnels become elevation tools, not just
crossings.

**Why.** Depth and realism; makes train weight (doc 03) matter; visually striking.

**How.** A `height` per cell; the sim's speed model (needs the Phase-2 momentum
model from `signaling-design.md`!) applies a grade penalty. This is a big, system-
touching feature — flag as long-horizon, post-momentum.

**Effort.** L. **Deps.** train momentum/speed model (signaling Phase 2); probably
2.5D rendering work. Likely "someday," not "soon."

---

### 2.10 — Decorative-only scenery ★

**What.** Pure cosmetics with no rules: scattered trees, houses, fields, ponds,
fences, signage. Placeable in sandbox/editor.

**Why.** Cheap charm; makes screenshots and the editor satisfying with near-zero
risk. Good "warm-up" task or first-timer-friendly contribution.

**How.** A decoration layer in the level data the sim ignores entirely; editor
brush to place them.

**Effort.** S. **Deps.** none (nice even on `develop`).

---

## Suggested teaching order (if we go campaign / Railbound-style)

A natural ramp where each feature answers the previous one's question:

1. Curves & routing (have it) → 2. Signals & switches (have it) →
3. **Obstacles** (2.7) pose "you can't go straight" → 4. **Bridges** (2.2) answer
"cross over" → 5. **Tunnels** (2.1) answer "go under the mountain" →
6. **Stations** (2.4) turn delivery into a network → 7. **Level crossings** (2.3)
add the road/rail conflict → 8. combine everything.

## Lowest-risk first slice from this doc

**Bridges (2.2) + obstacles (2.7)** on top of the data-driven model: together they
form one coherent "cross the river / route around the forest" mini-world, lean on
machinery the connection model already has, and need minimal new sim. Tunnels
(cosmetic) and decorative scenery (2.10) are cheap add-ons. Level crossings and
stations are higher-value but heavier — schedule them once road traffic / cargo
exist.
