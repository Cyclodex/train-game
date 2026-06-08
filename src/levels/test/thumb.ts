import { Level } from "@/tiles/model";
import { oppositePort } from "@/sim/topology";
import { segmentPathD } from "@/sim/pathGeometry";
import { railPathsFor } from "@/tiles/geometry";
import { roadSurfacePolygonPath, roadCurvePolygonPath } from "@/tiles/roadGeometry";
import { roadEdges, laneCount } from "@/tiles/lanes";

// A static, sim-free preview of a scenario's map, used as the background art for
// the /test gallery's image tiles. It reuses the same *pure* geometry the live
// tile renderer uses (railPathsFor, roadSurface/CurvePolygonPath) but none of the
// game-coupled detail (signals, switches, lane-drop gores, mismatch flags, cars).
// The result is a recognisable silhouette — grey road ribbons, rail tracks, depot
// markers — at thumbnail scale.
//
// Output is per-tile so the component can place each tile's local-coordinate paths
// under one `translate()` group, mirroring how TestStage lays out the grid.

// Tile unit in the thumbnail's viewBox. Arbitrary — paths scale with the card.
const UNIT = 100;
// Lane width as a fraction of the unit, matching the live renderer's constant so
// multi-lane roads read wider than single-lane ones.
const LANE_W = UNIT * 0.14;
// Half-gap between the two rails of a track, flanking the centreline.
const RAIL_OFFSET = UNIT * 0.14;

export interface ThumbTile {
  tx: number;
  ty: number;
  roads: string[]; // filled grey ribbon polygons
  bed: string[]; // rail trackbed centrelines (drawn under the rails)
  rails: string[]; // rail stroke paths (two per connection)
  depot: boolean; // draw a depot marker at the tile centre
}

export interface ScenarioThumb {
  cols: number;
  rows: number;
  unit: number;
  viewBox: string;
  tiles: ThumbTile[];
}

// Build the preview geometry for a level laid out on a `cols × rows` grid.
export function scenarioThumb(
  level: Level,
  grid: { cols: number; rows: number }
): ScenarioThumb {
  const tiles: ThumbTile[] = [];

  for (const [key, cell] of Object.entries(level)) {
    const [x, y] = key.split(",").map(Number);
    const roads: string[] = [];
    const bed: string[] = [];
    const rails: string[] = [];

    // Road ribbons: one grey polygon per undirected edge. Width = the tile's own
    // total lane count (min 2 so a one-way still reads as a road), with no
    // cross-tile taper — a thumbnail doesn't need seam-accurate widths.
    for (const [a, b] of roadEdges(cell.road)) {
      const total = Math.max(laneCount(cell.road, a) + laneCount(cell.road, b), 2);
      const w = total * LANE_W;
      roads.push(
        oppositePort(a) === b
          ? roadSurfacePolygonPath(a, b, UNIT, w, w)
          : roadCurvePolygonPath(a, b, UNIT, w)
      );
    }

    // Rails: a dark trackbed centreline plus the two flanking rails per connection.
    for (const [a, b] of cell.connections) {
      bed.push(segmentPathD(a, b, UNIT));
      for (const rail of railPathsFor(a, b, UNIT, RAIL_OFFSET)) rails.push(rail);
    }

    tiles.push({
      tx: x * UNIT,
      ty: y * UNIT,
      roads,
      bed,
      rails,
      depot: cell.role === "depot",
    });
  }

  return {
    cols: grid.cols,
    rows: grid.rows,
    unit: UNIT,
    viewBox: `0 0 ${grid.cols * UNIT} ${grid.rows * UNIT}`,
    tiles,
  };
}
