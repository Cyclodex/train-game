# Backing into a 90° bay — /test/parkinglot

`parkinglot-before.png` / `parkinglot-after.png`, both `--no-debug --wait 60000`.

**What to look at: the rank of bays, not the traffic.** The cars on the aisle are
in different places in the two frames and that means nothing — the render loop
steps on wall-clock time, so no two runs of `npm run shot` put the same car in
the same place (measured on `parkvariants`: two runs of an *unchanged* tree
differ by ~24.7k pixels).

The substance is the orientation of the parked cars. Before, every car in the
rank has its windscreen at the same end: they all nosed in, because the driver
preference was gated off. After, some sit the other way round — those backed in,
and they will drive out forwards. That is a car park rather than a diagram.

The clearance behind it is measured, not eyeballed: swept penetration into a
parked neighbour stays at +0.02px with the preference on, and the worst per-tick
heading step drops from 180.0° (the old spin on pull-out) to 26.3°. See
`tests/unit/sim/parking.spec.ts` and `docs/KNOWHOW.md` → PARKING.
