import { Port } from "@/sim/topology";
import { segmentPathD } from "@/sim/pathGeometry";

// Road rendering is the sibling of tiles/geometry.ts (rail): both derive their
// SVG from a cell's port pairs. A road carries no two flanking rails — it is a
// single paved ribbon — so the surface is just the centreline a car drives along
// (the same geometry trains follow, segmentPathD), stroked wide by the renderer.
// The lane marking shares that centreline and is dashed in the view.

// The paved-surface path for a road pair: a straight line for opposite/Center
// links, a quadratic through the tile centre for adjacent ports. Stroke it wide.
export function roadSurfacePath(entry: Port, exit: Port, size: number): string {
  return segmentPathD(entry, exit, size);
}

// The lane-marking path (dashed centreline). Identical to the surface centreline;
// the renderer draws it thin and dashed on top of the wide surface stroke.
export function roadMarkingPath(entry: Port, exit: Port, size: number): string {
  return segmentPathD(entry, exit, size);
}
