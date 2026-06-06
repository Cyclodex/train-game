# Cargo trucks — design

**Date:** 2026-06-06
**Status:** approved, implementing

## Goal

Add longer road vehicles alongside the existing uniform cars. Two new kinds:

- **truck** — a single rigid sprite, a bit longer than a car.
- **semi** — an articulated cab + trailer, rendered as two chord segments so the
  trailer bends on curves (the way a train's loco + wagon already render).

Same speed as cars for now (vehicle speed/accel variety is a separate topic). How
often each kind appears is a **per-level** setting.

## Background (current state)

Road traffic lives in `src/sim/road.ts` (headless) and is rendered by
`src/game.ts` + `PlayView.vue` / `TestStage.vue`. Every car today is identical:

- One `carLength` (in tiles) and one `carSpeed`, set once in `game.ts` from the
  38px `.road-car` sprite (`CAR_SPRITE_PX`). Sim body length and CSS sprite width
  are deliberately kept in sync so queues pack tight.
- `createRoadSim()` spawns cars at map-edge road openings; cars walk the `road`
  port-graph, queue bumper-to-bumper (`clearAhead` + `CAR_GAP`), and hold short of
  rail crossings (the `closed` callback = train reservation/occupancy on a tile).
- `sample()` returns one front/rear **chord** per car; `game.ts` `positionUnit`
  places a single `.road-car` div at the chord midpoint, angled along the chord.

## Design

### 1. Vehicle kinds as data (`road.ts`)

A kind is a list of render **segments** plus a coupling gap, scaled from the base
car length `B` (what `game.ts` already passes as `carLength`):

```ts
export type VehicleKind = "car" | "truck" | "semi";
interface VehicleSegment { length: number; part: "car" | "truck" | "cab" | "trailer"; }
interface VehicleSpec   { segments: VehicleSegment[]; gap: number; } // length & gap in tiles
```

| Kind  | Segments                                  | Total body |
|-------|-------------------------------------------|------------|
| car   | `[{1.0·B, car}]`                           | 1.0·B      |
| truck | `[{1.7·B, truck}]`                         | 1.7·B      |
| semi  | `[{0.7·B, cab}, {1.6·B, trailer}]`, gap 0.12·B | ~2.42·B |

`vehicleSpec(kind, base)` returns the spec scaled to a base length. A spec's
**total length** = Σ segment.length + gap·(n−1).

`Car` gains `kind: VehicleKind`; its `length` field (used by following/queueing)
becomes the spec's total length, so a longer vehicle automatically keeps a longer
gap behind it and occupies more of the lane.

### 2. Full-body occupancy — the trailer blocks crossings

This is the load-bearing change for the requirement *"the trailer must occupy
crossings and block other cars from entering it."*

Today `bodyPoints(car)` returns only **two** points (head + rear). A long trailer
can span an entire junction tile with *neither* endpoint on it, so a perpendicular
car projecting only those two points would not see the junction as occupied and
would drive in.

Fix: sample body points along the **whole body**, from the head back to the tail,
at a fixed arc step (`BODY_SAMPLE_STEP` ≈ 0.33 tiles), always including the exact
tail point. Every tile any part of the vehicle covers then gets at least one body
point. No other logic changes — this makes both existing mechanisms
length-agnostic:

- **Same-lane following** — a follower still stops `CAR_GAP` behind the nearest
  body point ahead, which for a leader is the back of its trailer.
- **Perpendicular junction / rail crossing** — `clearAhead`'s `isRoadJunction`
  branch now finds a projected body point sitting *on* the junction tile a trailer
  is straddling, so the crossing car holds short of the junction's entry edge
  instead of rolling into the occupied tile. `bodyTileIds` (used by spawn) is
  already full-span and needs no change.

### 3. Spawning by a per-level mix

`RoadSimConfig` gains `mix?: TrafficMix` where
`TrafficMix = { car?: number; truck?: number; semi?: number }` are **relative
weights**. `trySpawn` draws a kind via the existing seeded `rng` (deterministic),
then builds the car from that kind's spec. Default mix `{ car: 1 }` reproduces
today's all-cars behavior exactly. At spawn the vehicle sits at progress 0 on the
entry tile (its body extends backward off-grid), so the spawn free-tile check is
unchanged.

### 4. Per-segment render chords

`CarChord` becomes:

```ts
interface CarUnit  { front: CarSample; rear: CarSample; lengthTiles: number; part: string; }
interface CarChord { id: string; units: CarUnit[]; }
```

`sample()` emits one `CarUnit` per segment: `front` sampled at the segment's
leading arc-distance behind the head, `rear` at leading + segment.length (reusing
the existing `sampleAtArc`). Segments are laid out head→tail with the spec's gap
between them.

### 5. Renderer (`game.ts` + views)

- `RoadCar` (render type) gains `widthPx: number` and `part: string`. Each render
  unit's id is `${carId}#${i}`.
- `updateRoadCars` flattens every car's units into the reactive `roadCars` list,
  positioning each with the existing `positionUnit(... , laneOffset)` and setting
  `widthPx = lengthTiles · tileSize`.
- `PlayView.vue` / `TestStage.vue` v-for the units, set inline `width: widthPx`,
  add class `road-car--{part}` (cab drawn a touch darker than the body), and pick
  colour from the **base** car id (strip the `#i`) so a semi's cab + trailer share
  one livery. `carColor` strips the suffix.

### 6. Per-level config plumbing

`TrafficConfig = { spawnInterval?: number; mix?: TrafficMix; maxCars?: number }`.

`createGame(level, trainDefs, tileSize, colorSeed?, colors?, traffic?)` — a new 6th
optional param threaded into `createRoadSim` (overlaid on the existing hardcoded
defaults). `src/levels/default.ts` exports `DEFAULT_TRAFFIC` (occasional trucks +
the odd semi) that `PlayView` passes; custom/editor levels fall back to it.
`TestScenario` gains optional `traffic?: TrafficConfig`, passed by `TestStage`.

### 7. Test world scenario (`/test/trucks`) — required

A small map with a 4-way **road junction** and a `mix` weighted heavily toward
`truck`/`semi`, so the gallery shows: all three kinds queueing on one lane, and a
trailer straddling the junction while a perpendicular car waits for it to clear.
Registered in `src/levels/test/index.ts`; the existing
`tests/unit/levels/testScenarios.spec.ts` registry sweep validates it.

## Testing

- `npm run build` (vue-tsc + vite) — type-check the new interfaces and plumbing.
- `npm run test:unit` — existing coordinate/scenario tests stay green; the
  scenario sweep validates `/test/trucks`. Add a focused unit test for
  `vehicleSpec` totals and the weighted spawn distribution if cheap.
- Manual: `/test/trucks` shows the three kinds and the junction block.

## Known limitations

- A semi is longer than one tile. On a map where rail crossings sit closer
  together than the semi's body, its tail can still be over one crossing as its
  nose reaches the next. Acceptable for this cut.
- Vehicle speed/accel are identical across kinds (deferred, separate topic).
- Body-point sampling is a discrete step (~0.33 tile); a sub-step sliver of body
  at the very front of a tile is covered by the head point, so no gap in practice.
