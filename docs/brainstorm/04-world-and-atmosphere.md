# 04 — World & atmosphere (making it feel alive)

Features that don't change the core puzzle much but make the board feel like a
living place rather than a diagram. Cheap charm, high perceived-quality return.
Several of these are great low-risk tasks. The prompt explicitly asked about
**roads with cars / Bahnübergänge** and **forest & other obstacles** — the road
system lives here (the crossing *tile* is in doc 02 §2.3; the terrain *obstacles*
are in doc 02 §2.7); this doc covers the moving, ambient life.

---

## 4.1 — Road network with cars ★★★ (enables level crossings)

**What.** Roads as a second transport layer with little cars/buses/trucks driving
along them on their own. Mostly ambient, but they become *interactive* at a level
crossing (doc 02 §2.3), where they must stop for trains.

**Why it's fun.** Movement everywhere makes the world feel alive, and it's the
prerequisite that gives Bahnübergänge their drama (cars queue at the gate, the
boom lifts, they surge across). It can also become its own scoring axis ("don't let
cars wait too long").

**How it builds on what we have.** Reuse the sim pattern wholesale: cars are
lightweight actors advancing along a **road port-graph** that mirrors the rail
port-graph (the connection model expresses road port-pairs the same way as rail —
see doc 02). They obey an occupancy gate, exactly like trains. At a crossing the
car's gate is held by the train's reservation. Render as simple sprites on a road
layer. Start dumb (cars loop a fixed road) and add interactivity at crossings.

**Effort.** L (a parallel actor system) — but it directly reuses sim machinery, so
less than it sounds. **Deps.** road tiles (a `road` role in the connection model);
crossing tile (2.3) for the payoff.

**Phasing.** v0: purely decorative cars on a closed loop. v1: cars stop at
crossings. v2: cars are scored / can be hit (fail). Each is a shippable step.

---

## 4.2 — Towns / cities that grow ★

**What.** Clusters of buildings near stations; serving a station well makes its town
grow (more buildings, more demand) — OpenTTD's feedback loop, lite.

**Why.** Visible consequence of good play; a reason to invest in a region; makes the
map evolve over a session.

**How.** A town = a render cluster + a demand multiplier tied to a station's
delivery history (objective layer, doc 01). No sim change; it's bookkeeping +
sprites.

**Effort.** M. **Deps.** stations (2.4), demand (3.4).

---

## 4.3 — Day/night cycle ★★

**What.** A slow lighting cycle; at night, signals/headlights/level-crossing lights
glow, windows light up.

**Why.** Huge atmosphere-per-effort. Signals and crossings *pop* at night; great
for screenshots; basically free juice once we have signal/crossing lights.

**How.** A global time value driving a CSS/SVG overlay tint + toggling glow filters
on light-emitting elements. Renderer-only; sim untouched (or sim time can feed it).

**Effort.** S–M. **Deps.** none (works today); best with signals/crossings present.

---

## 4.4 — Weather & seasons ★

**What.** Rain, snow, fog as overlays; optionally seasonal palette (green → autumn →
snow). Optionally *mechanical*: snow/ice reduces braking, fog shortens sight (ties
to Phase-2 distant signals).

**Why.** Variety and mood; seasons make a long session visibly progress. Mechanical
weather adds depth but needs the momentum model.

**How.** Cosmetic: particle/overlay layer + palette swap, renderer-only. Mechanical:
a global modifier on the (future) speed/braking model.

**Effort.** S (cosmetic) / L (mechanical). **Deps.** none cosmetic; momentum model
(Phase-2) for mechanical.

---

## 4.5 — Wildlife & small life ★

**What.** Birds, deer near forests, cows in fields, smoke from chimneys, water
shimmer. Tiny animations.

**Why.** The small details that make people say "this is charming." Near-zero
gameplay risk.

**How.** Decoration layer (doc 02 §2.10) with simple looping animations; sim
ignores it.

**Effort.** S. **Deps.** none.

---

## 4.6 — Sound design ★★

**What.** Departure whistle, chuff/hum while moving, brake squeal at red, the
*ding-ding* + descending boom of a level crossing, a delivery jingle, a crash
clang. Ambient bed (birdsong by day, crickets at night).

**Why.** Sound is the cheapest, highest-impact juice there is — `IMPROVEMENTS.md`
§5 already flags it. The crossing especially *needs* its audio to land.

**How.** A small audio manager subscribing to sim/game events (depart, brake,
deliver, crash, gate-down). Events already exist (`gameLog.ts`, depot/sim events).
Respect a mute toggle and autoplay rules.

**Effort.** S–M. **Deps.** none; richer with crossings/signals.

---

## 4.7 — Camera: pan / zoom / follow ★★

**What.** Pan & zoom the board; optionally a "follow this train" cam. Needed the
moment maps get bigger than one screen (procgen can already make big maps).

**Why.** Bigger, more ambitious levels become playable and showable; following a
train is delightful.

**How.** A viewport transform (CSS transform / SVG viewBox) around the board layer;
pointer + wheel handlers. Renderer-only.

**Effort.** M. **Deps.** none, but increasingly necessary as boards grow (procgen,
campaign).

---

## 4.8 — Particles & juice ★

**What.** Steam/smoke puffs, spark on hard braking, dust when terrain is cleared,
confetti on a delivery, screen-shake on a crash.

**Why.** "Juice" is what separates a tech demo from a game that *feels* good.

**How.** A lightweight particle layer hooked to the same event stream as sound.

**Effort.** S–M. **Deps.** none.

---

## Discussion seeds

- **Cheap wins with outsized feel:** day/night (4.3) + sound (4.6) + particles
  (4.8) could be a single "juice pass" that makes the *current* game feel twice as
  finished, independent of any new mechanic. Good morale/demo slice.
- **Road network (4.1)** is the big one here — it's a whole second actor system, but
  it unlocks the Bahnübergang the prompt specifically wanted. Decide whether
  crossings are worth the road system, or whether a *simplified* "abstract road
  actors" stub gets 80% of the drama for 20% of the work.
