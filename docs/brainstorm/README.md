# Feature brainstorm — index

A wide-net brainstorm of where the train game could go next. Written to be argued
over, not followed: every item is a starting point, with a rough sense of value,
effort, and how it would sit on top of the architecture we already have. Nothing
here is committed — tomorrow we prune, combine, and pick a slice.

Scope of this round (from the prompt): game **goals / objectives**, plus concrete
world features — **tunnels, bridges, level crossings (Bahnübergänge), stations,
and obstacles / terrain (forest & friends)** — and anything else that makes the
world feel alive.

## How to read these docs

Each idea follows the same shape so we can skim and compare:

- **What** — the feature in one or two sentences.
- **Why it's fun / why it matters** — the player-facing payoff.
- **How it builds on what we have** — the honest implementation sketch, named
  against real files (`src/sim/*`, `src/tiles/*`, `src/game.ts`).
- **Effort** — rough T-shirt size: **S** (hours), **M** (a day or two), **L**
  (multi-day / needs a prerequisite).
- **Deps** — what must land first.

Value is marked ★ (nice) to ★★★ (high impact) where it's worth flagging.

## The files

1. [`01-objectives-and-game-modes.md`](01-objectives-and-game-modes.md) — the
   missing objective loop: scoring, win/lose, campaign, puzzle vs. endless vs.
   sandbox, star ratings, scenarios.
2. [`02-terrain-and-tile-types.md`](02-terrain-and-tile-types.md) — the headline
   physical features: **tunnels, bridges, level crossings, stations**, and
   **terrain/obstacles** (forest, water, hills, rock). This is the big one for
   tomorrow.
3. [`03-trains-cargo-economy.md`](03-trains-cargo-economy.md) — train variety,
   cargo & production chains, passengers, momentum/speed, upgrades, money.
4. [`04-world-and-atmosphere.md`](04-world-and-atmosphere.md) — roads with cars,
   towns, day/night, weather, seasons, wildlife, sound — making it feel alive.
5. [`05-signaling-routing-advanced.md`](05-signaling-routing-advanced.md) —
   continuing the signaling roadmap (Phase 2/3): braking, yellow aspects,
   schedules/timetables, deadlock resolution, auto-routing.
6. [`06-ux-progression-polish.md`](06-ux-progression-polish.md) — HUD, tutorials,
   save/load, achievements, accessibility, level sharing, juice.
7. [`99-open-questions.md`](99-open-questions.md) — the decisions to make first;
   the questions that change everything downstream. **Start here tomorrow.**

## The one thing to internalise before reading

The biggest leverage point is **already half-built**: the data-driven,
connection-based tile model + level editor + procedural generation on branch
`worktree-data-driven-tiles` (see the `data-driven-tiles` memory and
`docs/superpowers/specs/2026-06-05-data-driven-tiles-design.md`). A cell is just
`{ connections: PortPair[], role?, signals? }`. **Almost every physical feature
below (tunnels, bridges, crossings, stations, obstacles) is "another role / another
derived layer on a cell."** Merging that branch is the unlock for most of this
brainstorm, so it's assumed as the foundation throughout. Decide on the merge
first (see `99-open-questions.md`).

## Where today's game stands (baseline)

- Authoritative headless sim (`src/sim/*`) advancing trains on a `step(dt)` tick;
  thin rAF renderer (`src/game.ts`) draws sampled positions. Deterministic,
  unit-tested.
- **Signaling Phase 1** done: block/route reservation (interlocking),
  always-visible directional red/green signals, manual hold. No braking model yet
  (Phase 2/3 deferred — see `docs/signaling-design.md`).
- Trains pathfind depot→depot; colour-match = "delivery" but **there is no score,
  no win/lose, no objective loop** — that's the headline gap (doc 01).
- Tile kinds today: straight, curve, intersection, depot. Everything is flat track
  on a 7×6 grid. No terrain, no elevation, no non-track world objects.

## Research touchstones (what good train games do)

Drawn from a quick survey — full notes inline in the docs:

- **Train Valley 2** — per-level objectives + **optional star objectives** (no
  crashes, under N time, deliver to the right building), production chains,
  player-triggered departures, click-to-flip switches.
- **Railbound** — each *world* introduces **one new mechanic** (tunnels, numbered
  stations, barriers, bumpers) then later worlds *combine* them. A masterclass in
  teaching mechanics one at a time. Strong model for our level progression.
- **OpenTTD** — bridges & tunnels as terrain answers, drag-to-build stations,
  deep signal types, cargo economy where distance = revenue.
- **Mini Metro** — minimalist: shapes-to-shapes delivery, station overcrowding as
  the fail state, weekly **pick-an-upgrade** (extra line, carriage, **bridge** to
  cross a river). Difficulty from rising demand, not complexity.
- **Level-crossing games** — the Bahnübergang as its own mini-tension: gates,
  flashing lights, road traffic that must be let through.

Sources collected in `99-open-questions.md`.
