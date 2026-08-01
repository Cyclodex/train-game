import { TileCell } from "@/tiles/model";
import { expandKind } from "@/tiles/kinds";
import { TestScenario, mkTrain } from "@/levels/test/scenario";

// A mountain ridge, and the tunnel bored through it — the second exception to
// `canBuildOn`, in isolation. The bridge's twin: water is SPANNED (the line
// rides over it, deck and shadow visible), rock and mountain are BORED (the
// line goes underground and disappears).
//
// Three things to read off this board:
//  1. **The ground stays unbroken over the bore.** A tunnel cell lays no
//     keep-out corridor (`cellCorridors`), so the mountain's scatter closes
//     over the line instead of clearing a right-of-way — the one thing that
//     visually separates a tunnel from a cutting. Only the dashed guide (map
//     notation) says where it runs.
//  2. **The train drives INTO the portal.** Nothing is switched off. The dark
//     opening renders UNDER the trains, the masonry over them, and the bore's
//     own mountain over that (a clipped second copy of the rock, `.tile-roof`),
//     so a unit runs into the dark, is swallowed at the arch, and comes out the
//     far side the same way. Watch a nose enter: it goes in gradually.
//  3. **Portals only where the bore meets open ground.** The ridge is two
//     tiles deep and the seam between its two tunnel cells gets no portal —
//     one mountain, one hole in each side.
//
// Build it yourself: drawing a route across rock/mountain in the editor or a
// Tycoon board lays the bore automatically (`addConnection` sets
// `TileCell.tunnel`) and charges `TUNNEL_BUILD_FACTOR` — nine tiles' worth of
// routing cost per ridge tile keeps the planner going round anything that CAN
// be gone round.
const mountain = (): TileCell => ({ connections: [], terrain: "mountain" });
const rock = (): TileCell => ({ connections: [], terrain: "rock" });

const level: Record<string, TileCell> = {};

// The ridge: a two-wide wall of mountain down columns 4-5, edge to edge, with
// rocky feet on the east flank — so there is no way round, only through.
for (let y = 0; y <= 4; y++) {
  level[`4,${y}`] = mountain();
  level[`5,${y}`] = mountain();
}
level["6,0"] = rock();
level["6,4"] = rock();

// A wood on the western approach, for scale against the bare ridge.
for (const id of ["1,0", "2,0", "1,4"]) {
  level[id] = { connections: [], terrain: "forest" };
}

// The line: depot to depot straight through the ridge, bored at 4,2 and 5,2.
const row = 2;
for (let x = 0; x <= 8; x++) {
  level[`${x},${row}`] = expandKind("straight", 1);
}
for (const x of [4, 5]) {
  level[`${x},${row}`] = {
    ...expandKind("straight", 1),
    terrain: "mountain",
    tunnel: true,
  };
}
level[`0,${row}`] = expandKind("depot", 1);
level[`8,${row}`] = expandKind("depot", 3);

export const tunnel: TestScenario = {
  id: "tunnel",
  name: "Mountain & tunnel",
  description:
    "A ridge cannot be spanned, only bored: the tunnel is the second exception inside canBuildOn. The train vanishes at one portal and re-emerges at the other, and the mountain stays unbroken over the line.",
  size: { cols: 9, rows: 5 },
  level,
  trains: {
    train1: mkTrain("train1", 0, row, "people", 2, `8,${row}`),
  },
};
