<template>
  <svg
    v-if="html"
    class="tile-ground"
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
  GROUND_UNITS,
  TerrainNeighbours,
  terrainOf,
  tileGroundSvg,
} from "@/tiles/terrain";

// The world's ground, one tile at a time. A sibling of <Tile> rather than a
// layer inside it, because ground exists whether or not anything is built on the
// cell: a lake tile carries no track, and the grass between two spurs is still
// somewhere. The view already renders a `.level-tile` box for every cell in the
// bounds — occupied or not — so that box is exactly the right place for it.
//
// Cosmetic only: nothing here feeds the simulation. See tiles/terrain.ts.
const TERRAIN_SEED = 20260726;

@Component({})
class TileGround extends Vue {
  @Inject() level!: Level;
  @Prop({ type: String, required: true }) coordId!: string;

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

  get html(): string {
    const kind = terrainOf(this.level[this.coordId]);
    return tileGroundSvg(kind, this.coordId, this.neighbours, TERRAIN_SEED);
  }
}
export default toNative(TileGround);
</script>

<style lang="scss" scoped>
.tile-ground {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  // Below the road surface (z1) and the rails (z2), so nothing the player has
  // built is ever hidden by scenery — a tree may stand beside the track, never
  // on it. Clicks belong to the cell underneath (the editor listens there).
  z-index: 0;
  pointer-events: none;
  // A patch's corners are nudged OFF the tile grid and its shores bow between
  // them, so the outline legitimately crosses the tile boundary — that overlap
  // is exactly how two neighbouring patches interlock instead of butting up in
  // a straight line. Clipping it back to the box would reinstate the grid we
  // just spent the jitter escaping.
  overflow: visible;
}
</style>
