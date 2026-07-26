<template>
  <svg
    v-if="html"
    :class="layer === 'canopy' ? 'tile-canopy' : 'tile-ground'"
    :viewBox="`0 0 ${units} ${units}`"
    preserveAspectRatio="none"
    v-html="html"
  />
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { Level } from "@/tiles/model";
import { parseCoordId } from "@/tiles/model";
import { getCoordinatesId } from "@/utils/tileHelpers";
import {
  Corridor,
  GROUND_UNITS,
  TerrainNeighbours,
  corridorsFor,
  terrainOf,
  tileCanopySvg,
  tileGroundSvg,
} from "@/tiles/terrain";

// The world's ground, one tile at a time. A sibling of <Tile> rather than a
// layer inside it, because ground exists whether or not anything is built on the
// cell: a lake tile carries no track, and the grass between two spurs is still
// somewhere. The view already renders a `.level-tile` box for every cell in the
// bounds — occupied or not — so that box is exactly the right place for it.
//
// Two layers, chosen by the `layer` prop: "ground" (default) draws the terrain
// patch and its scatter UNDER the rails; "canopy" draws the forest trees whose
// crowns overhang a line ABOVE the trains, so a train passes beneath the
// foliage. Views mount one of each per cell.
//
// Cosmetic only: nothing here feeds the simulation. See tiles/terrain.ts.
const TERRAIN_SEED = 20260726;

@Component({})
class TileGround extends Vue {
  @Inject() level!: Level;
  @Prop({ type: String, required: true }) coordId!: string;
  @Prop({ type: String, default: "ground" }) layer!: "ground" | "canopy";

  units = GROUND_UNITS;

  private kindAt(x: number, y: number) {
    return terrainOf(this.level[getCoordinatesId({ x, y })]);
  }

  // The DIAGONALS matter as much as the sides: they are what tells a corner
  // apart from the middle of a shore that runs on into the next tile, and only
  // the middle of a run may be smoothed. Give a reflex corner (an L's inside
  // corner) the smoothing and the two tiles disagree about where it sits.
  get neighbours(): TerrainNeighbours {
    const { x, y } = parseCoordId(this.coordId);
    return {
      top: this.kindAt(x, y - 1),
      right: this.kindAt(x + 1, y),
      bottom: this.kindAt(x, y + 1),
      left: this.kindAt(x - 1, y),
      topLeft: this.kindAt(x - 1, y - 1),
      topRight: this.kindAt(x + 1, y - 1),
      bottomRight: this.kindAt(x + 1, y + 1),
      bottomLeft: this.kindAt(x - 1, y + 1),
    };
  }

  // Rails and roads through this cell AND the four side-neighbours: scatter
  // keeps its footprint off them (a canopy can reach over the tile edge).
  get corridors(): Corridor[] {
    const { x, y } = parseCoordId(this.coordId);
    const at = (dx: number, dy: number) =>
      this.level[getCoordinatesId({ x: x + dx, y: y + dy })];
    return corridorsFor(this.level[this.coordId], {
      top: at(0, -1),
      right: at(1, 0),
      bottom: at(0, 1),
      left: at(-1, 0),
    });
  }

  get html(): string {
    const kind = terrainOf(this.level[this.coordId]);
    const build = this.layer === "canopy" ? tileCanopySvg : tileGroundSvg;
    return build(kind, this.coordId, this.neighbours, TERRAIN_SEED, this.corridors);
  }
}
export default toNative(TileGround);
</script>

<style lang="scss" scoped>
.tile-ground,
.tile-canopy {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  // A patch's corners are nudged OFF the tile grid and its shores bow between
  // them, so the outline legitimately crosses the tile boundary — that overlap
  // is exactly how two neighbouring patches interlock instead of butting up in
  // a straight line. Clipping it back to the box would reinstate the grid we
  // just spent the jitter escaping. (And a canopy overhanging the line reaches
  // over the tile edge by design.)
  overflow: visible;
}
.tile-ground {
  // Below the road surface (z1) and the rails (z2), so nothing the player has
  // built is ever hidden by GROUND scenery — a tree may stand beside the track,
  // never on it. Clicks belong to the cell underneath (the editor listens
  // there).
  z-index: 0;
}
.tile-canopy {
  // Above the rails (z2) and the trains (wagons z3 / loco z4), below the road
  // cars (z6) and crossing booms: the one layer of scenery a train slips UNDER.
  z-index: 5;
}
</style>
