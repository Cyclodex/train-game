# Life stages and daily routines

*2026-08-04 — extends `2026-08-01-citizens-and-cities-design.md` (its "Phase C —
the rest of life").*

## 1. The problem, measured

The citizen simulation gives every resident the same life. `addCitizen` rolls
three numbers and that is the whole of a person's day:

```ts
outHour:  7 + habitRng() * 2,    // 07:00–09:00
backHour: 16 + habitRng() * 2,   // 16:00–18:00
shopHour: 10 + habitRng() * 9,   // and only every OTHER day
```

Everyone leaves within the same two hours and comes back within the same two
hours, so the board has two sharp spikes and a dead middle. The quarter of
residents with no job (`joblessShare: 0.25`) make it worse rather than better:
their entire life is one errand every second day.

The town therefore looks alive twice and abandoned for the other twenty hours.

## 2. What we are building

**A person's day becomes a list, not three numbers**, and which list you get
depends on what stage of life you are at. Five stages, chosen so that between
them they cover the clock:

| stage | share | day | fills |
|---|---:|---|---|
| `worker` | 50 % | 07–09 work · 16–18 home · errand every 2nd day | today's peaks |
| `shiftWorker` | 12 % | errand 10:00 · **13:30 work** · **21:30 home** | afternoon + night |
| `tradesperson` | 13 % | 06:30 yard · **09:00 call-out** · 11:30 yard · **13:30 call-out** · 16:00 yard · 17:00 home | the whole midday |
| `retired` | 15 % | **09:30 café/shop, DAILY** · **14:00 visit**, every 2nd day | morning + early afternoon |
| `child` | 10 % | **07:30 school** · **12:30 home** · 15:30 play, every 2nd day | the midday counter-peak |

Two of these are the user's own observations and are worth stating in their
terms:

- **The tradesperson is not a new kind of person.** It is the same person who
  goes to work; they simply have a job that moves. They leave home for the yard
  like anybody else, and then the day is a round of call-outs — a boiler here, a
  delivery there — in a company van. That is why they always own a car and why
  their `carAffinity` is low: the van is the job.
- **The school is the only counter-peak generator on the board.** Children
  travel *before* the commuters and come home at *half past twelve* — precisely
  into the hole. A child whose school is in the next town is also the best
  reason to run a train that the mode has ever had, because it is demand that
  does not look like a commute.

## 3. Model

### 3.1 The routine

`Citizen` loses `outHour`/`backHour`/`shopHour` and the three `lastXDay` fields,
and gains:

```ts
export type LifeStage = "child" | "worker" | "shiftWorker" | "tradesperson" | "retired";

export interface Activity {
  // Where this sends them — resolved when it FIRES, never stored. An activity is
  // named by its destination, so this IS the trip's purpose; there is no second
  // `purpose` field to keep in step with it.
  target: TripPurpose;
  // Only fire when they are currently at this place. Absent = from anywhere,
  // which is what a trip home always is.
  from?: TripPurpose;
  hour: number;       // earliest start, on the in-game clock
  windowH: number;    // how long the window stays open; past it, skipped
  everyNDays: number; // 1 = daily, 2 = every other day
  lastDay: number;    // fired-today bookkeeping, exactly as lastOutDay was
}

export interface Citizen {
  // …
  stage: LifeStage;
  routine: Activity[];  // ordered by hour
}
```

`from` earns its place immediately: the old errand was rolled anywhere from
10:00 to 19:00 and then gated on being at home, so for most workers the window
opened while they were at their desk and **the trip simply never happened**.
Anchoring an activity to where it starts says that out loud instead of losing it.

`considerTrips` becomes: the 22:00 curfew first (unchanged), then walk the
routine in order and fire the first activity that is *eligible* —

1. `lastDay !== dayIndex`,
2. `hour >= a.hour && hour < a.hour + a.windowH`,
3. `(dayIndex + hashOf(c.id) + index) % a.everyNDays === 0`,
4. its target resolves to somewhere, and that somewhere is not where you already
   are.

Failing (4) marks the activity done for the day rather than retrying it every
tick — the same contract `lastOutDay` had, so a refused trip is scored once.

**Why resolve at fire time.** A target is a *role*, not an address: the nearest
shop can fill up, a call-out is a different address every day, and a school may
not exist on this board at all. Storing an address at move-in would freeze all
three.

### 3.2 Targets

| target | resolves to |
|---|---|
| `home` | `c.home` |
| `work` | `c.work` |
| `shop` | nearest `shop` plot (today's `nearestShopFor`) |
| `leisure` | nearest `leisure` plot, falling back to nearest `shop` |
| `school` | nearest `school` plot; **null on a board with no school** |
| `callout` | a daily deterministic pick from work/home/shop plots, never your own workplace, biased toward another city |

The call-out pick is `hash(dayIndex, c.id)` over the pool, so it is stable
within a day, different between days, and identical on every replay — the same
determinism rule the rest of the sim keeps.

### 3.3 Purposes and topics

`TripPurpose` gains `school`, `callout`, `leisure`. `Topic` does **not** change:

- `school`, `callout` → `commute` (a child who cannot reach school is a network
  failure of exactly the same kind as a commute that cannot be made)
- `leisure` → `errands`

So `CityHappiness`, `recompute()`'s weighting and every existing test of the
happiness model are untouched. This is deliberate: the feature is about *when*
people travel, not about a new way to score them.

### 3.4 Plot kinds

`PlotKind` gains `school` and `leisure`, and `TileCell` gains the override the
previous design already parked:

```ts
/** Force this plot's kind, overriding what the terrain would say. */
zone?: PlotKind;
```

`PlotKind` moves to `tiles/model.ts` (it is tile data now) and is re-exported
from `tiles/cities.ts`, so every existing import keeps working.

Derivation in `plotsOf` becomes: `cell.zone ?? (industry ? "work" : shop ? "shop" : "home")`.
No new `TerrainKind` — a school stands on urban ground like everything else.

**Capacity is the trap here.** A plot's `people` means *filled jobs* for every
non-`home` kind, and `reviewDay` gates a town's growth on `freeJobs > 0`. Give a
school a capacity of 160 "pupils" and every town grows into imaginary
employment. So:

```ts
school:  [3, 6, 12, 24]   // teachers
leisure: [2, 4,  8, 16]   // café staff
```

Pupils are not capacity at all — a `school` trip never touches `plot.people`,
only `assignJob` does. A school with three teachers can teach the whole town,
which is both true enough and the only version that does not corrupt growth.

### 3.5 Stage mix and profiles

`CitizenTuning.joblessShare` is **replaced** by:

```ts
stageMix: Record<LifeStage, number>;  // shares, normalised
```

`joblessShare` was already documented as "children, retired"; it is now those
two shares, said out loud. Tests that set `joblessShare: 0` say
`stageMix: { worker: 1, … }` instead, which is clearer about what it wants.

`makeProfile` takes the stage:

| stage | car | walk patience |
|---|---|---|
| `child` | never | normal |
| `retired` | `carOwnership * 0.6` | lower |
| `tradesperson` | **always** (company van), low `carAffinity` | normal |
| others | `carOwnership` | normal |

`assignJob` gains a preferred kind so a tradesperson gets a `work` yard rather
than a café.

## 4. What the player sees

- `PersonCard` gains `stage` + a rendered `stageLabel`, and replaces
  `leavesAt`/`returnsAt`/`shopsAt` with `schedule: { at, what }[]` — the routine,
  in words. `CitizenInspector.vue` prints the list it is given instead of three
  hardcoded lines.
- `doingOf` learns the new purposes ("walking to school", "driving to a job",
  "off to the café").
- `CitizenStats` gains `byStage: Record<LifeStage, number>` so the city panel can
  say what kind of town this is.

Nothing else in the renderer changes: plot **kind** is not drawn today (buildings
come from terrain art), so `school` and `leisure` need no new sprites.

## 5. Boards

### 5.1 `/test/citizenday` — the mechanic in isolation

One town with all five destinations in it (homes, a works yard, a shop parade, a
school, a café), a neighbour village, one road between them and one railway.
Small enough to read, complete enough that every stage has somewhere to go.

**What it proves:** the population counter for "travelling" stops being two
spikes. That is the whole feature, and it is visible on the HUD.

**Measured on that board** — the busiest "travelling" count in each in-game hour,
one full day, same map and same seed, only the stage mix changed:

| hour | 06 | 07 | 08 | 09 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| all workers | 0 | 26 | 30 | 30 | 14 | 10 | 8 | 3 | **0** | **0** | 26 | 32 | 34 | 33 | 27 | 7 |
| life stages | 6 | 18 | 25 | 27 | 16 | 12 | 14 | 17 | 17 | 14 | 25 | 32 | 31 | 21 | 14 | 13 |

Trough-to-peak goes from **0.00 to 0.19**: two spikes with a hole in the middle
become a day. Note the peaks barely move — this is not more people, it is the
same people spread over the hours they would really use.

### 5.2 `/test/hinterland` — the big world

36×24 (864 tiles, ~3× demoworld). Composed from the same `rect`/loop helpers
demoworld uses, not 864 literal entries.

- **Marktstadt**, the large village: an 8×6 urban block, shop core, school, café.
- **Werk Ost**, industry: a 6×4 industrial block with its own station.
- **Nordheim** and **Südau**, the neighbour villages.
- One road links Marktstadt and Südau, so cars are an option *there*. There is
  deliberately **no road** to Werk Ost or Nordheim — that is what makes the
  railway the only answer, exactly as `threecities` does it with distance.
- Level crossings where road meets rail; signals spaced so several trains share
  the line.

## 6. Verification

- Unit: `tests/unit/sim/citizenRoutines.spec.ts` —
  - each stage produces the expected activity list;
  - the routine is deterministic for a seed;
  - a call-out target varies by day and is never the person's own workplace;
  - a board with no school skips a child's school trip without a refusal storm;
  - **the coverage test**: sample `stats().travelling` every in-game hour over a
    day; assert somebody is out in every hour from 07:00 to 21:00, and that the
    quietest daytime hour is not near-zero. The all-worker baseline fails this.
- Registry: the two new scenarios are validated by
  `tests/unit/levels/testScenarios.spec.ts` for free.
- Existing suites (`citizens.spec.ts`, `citizenCommute.spec.ts`,
  `citizenDriving.spec.ts`, `citizenWalking.spec.ts`, `citizenInspector.spec.ts`)
  must stay green; where they set `joblessShare` they move to `stageMix`.
- Visual: `npm run shot -- hinterland` and `npm run shot -- citizenday`.

## 7. Traps recorded in advance

- **A school is not a job for its pupils.** Pupil counts must never reach
  `plot.people`, or growth reads free capacity that is not employment. §3.4.
- **Resolve targets at fire time, never at move-in.** §3.1.
- **Do not add a `Topic`.** The new purposes fold onto `commute` and `errands`;
  adding a fourth topic drags `CityHappiness`, `recompute()` and the panel with
  it for no gain. §3.3.
- **Home activities need a wide window plus the curfew.** Today `backHour` has
  no upper bound at all; a narrow window would strand anyone whose journey home
  started late.
- **`everyNDays` parity must include the activity index**, or all of a person's
  every-other-day activities land on the same days and the other day is empty
  again — the bug this whole design exists to fix, in miniature.
