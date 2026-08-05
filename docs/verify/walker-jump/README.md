# Walkers jumping sideways and a tile backwards

Reported from the board: a citizen walked up from the south, crossed the street,
"went left, and suddenly appeared right".

Both images are the SAME two walks on `/test/citizencrossback`, traced tick by
tick over the board's own geometry (`pavementPaths`, `crossingPaths` and
`roadSurfacePath` — the modules the board renders with), with any single tick
longer than a stride ringed in red.

| | |
| --- | --- |
| `walks-before.png` | The two bugs. **1.02 tiles** backwards after the zebra (the route leaves the crossing tile by the edge it arrived at, and used to walk on to the far edge instead of retracing), and **0.44 tiles** — one road's width — sideways at the corner seam (the two tiles spell the same bank with opposite signs). |
| `walks-after.png` | The same two walks, continuous end to end. The only time either walker is on the tarmac is on the stripes. |
| `citizencrossback-board.png` | The scenario as a player sees it: closed ring, one zebra, figures on the pavements. Debug overlay off, flat backdrop, `npm run shot -- citizencrossback`. |

Left panel of each trace is house → works directly across the road (the
double-back); right panel is house → works round the north-west bend (the
corner). Same routes, same seed, same flags in both images.
