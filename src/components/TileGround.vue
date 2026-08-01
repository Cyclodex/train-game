<template>
  <svg
    v-if="html"
    :class="[`tile-${layer}`, { 'tile-over-bore': overBore }]"
    :viewBox="`0 0 ${units} ${units}`"
    preserveAspectRatio="none"
    v-html="html"
  />
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import { Level, heightOf } from "@/tiles/model";
import { parseCoordId } from "@/tiles/model";
import { getCoordinatesId } from "@/utils/tileHelpers";
import {
  Corridor,
  GROUND_UNITS,
  PatchSame,
  TerrainNeighbours,
  corridorsFor,
  terrainOf,
  tileCanopySvg,
  tileGroundSvg,
  tileHeightSvg,
  tileScatterSvg,
} from "@/tiles/terrain";

// The world's ground, one tile at a time. A sibling of <Tile> rather than a
// layer inside it, because ground exists whether or not anything is built on the
// cell: a lake tile carries no track, and the grass between two spurs is still
// somewhere. The view already renders a `.level-tile` box for every cell in the
// bounds — occupied or not — so that box is exactly the right place for it.
//
// THREE layers, chosen by the `layer` prop, and views mount one of each per
// cell:
//  - "ground" (default): the flat patch, rim and ground marks — under
//    everything (z0).
//  - "scatter": the standing objects (trees, buildings, boulders, ridges) at
//    z1, ABOVE every tile's patch fill. The split exists because tiles render
//    in DOM order: a later tile's opaque patch used to decapitate any canopy
//    that legitimately overhung the seam. With all patches below all scatter,
//    an overhanging crown survives — which is also what lets deep-forest trees
//    stand right on a shared seam. Still under roads/rails (later DOM, z>=1).
//  - "canopy": forest crowns overhanging a corridor, above the trains (z5).
//
// Cosmetic only: nothing here feeds the simulation. See tiles/terrain.ts.
const TERRAIN_SEED = 20260726;

@Component({})
class TileGround extends Vue {
  @Inject() level!: Level;
  // For the terrace tints: a hill is only "higher" relative to the ground the
  // THEME paints, so the height layer needs to know which world it stands in.
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Prop({ type: String, required: true }) coordId!: string;
  @Prop({ type: String, default: "ground" }) layer!: "ground" | "scatter" | "canopy";

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

  // The hypsometric terrace an elevated cell lays UNDER its terrain patch:
  // "same" here compares HEIGHT, not kind — a neighbour at or above this
  // height continues the terrace (the higher one lays its own, lighter body),
  // a lower one is where the slope face paints. See tileHeightSvg.
  get heightHtml(): string {
    const h = heightOf(this.level[this.coordId]);
    if (h === 0) return "";
    const { x, y } = parseCoordId(this.coordId);
    const at = (dx: number, dy: number) =>
      heightOf(this.level[getCoordinatesId({ x: x + dx, y: y + dy })]) >= h;
    const same: PatchSame = {
      top: at(0, -1),
      right: at(1, 0),
      bottom: at(0, 1),
      left: at(-1, 0),
      topLeft: at(-1, -1),
      topRight: at(1, -1),
      bottomRight: at(1, 1),
      bottomLeft: at(-1, 1),
    };
    // The debug flat ground is its own (much darker) anchor — a terrace tinted
    // for the meadow board would glare on it, and the shot pipeline runs with
    // plainBackdrop on by default.
    const theme = this.config.plainBackdrop ? "plain" : this.config.worldTheme;
    return tileHeightSvg(h, this.coordId, same, TERRAIN_SEED, theme);
  }

  // A BORED cell's ground is a ROOF, not a floor: the mountain over a tunnel
  // renders ABOVE the trains instead of under them (see the .tile-over-bore
  // rule), so a consist slides behind the rock pixel by pixel as it reaches the
  // portal. The canopy layer is already above the trains and stays where it is.
  //
  // Safe because a bore only ever exists on tunnelable ground (`addConnection`
  // sets `TileCell.tunnel` exactly where `needsTunnel` holds — rock/mountain),
  // and those kinds paint an opaque patch that covers the whole tile. A bore
  // hand-authored onto grass would have no roof, and its train would drive over
  // the top in plain sight — which is the right way for invalid data to read.
  get overBore(): boolean {
    return this.layer !== "canopy" && this.level[this.coordId]?.tunnel === true;
  }

  get html(): string {
    const kind = terrainOf(this.level[this.coordId]);
    const build =
      this.layer === "canopy"
        ? tileCanopySvg
        : this.layer === "scatter"
          ? tileScatterSvg
          : tileGroundSvg;
    const base = build(kind, this.coordId, this.neighbours, TERRAIN_SEED, this.corridors);
    // The terrace renders below the terrain patch, on the ground layer only.
    return this.layer === "ground" ? this.heightHtml + base : base;
  }
}
export default toNative(TileGround);
</script>

<style lang="scss" scoped>
.tile-ground,
.tile-scatter,
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
  // Below the scatter (z1) and everything built, so a later tile's patch fill
  // can never cover a neighbour's standing objects. Clicks belong to the cell
  // underneath (the editor listens there).
  z-index: 0;
}
.tile-scatter {
  // Above every tile's patch (z0), below the rails (z2). Same z as a road
  // surface, but the road is later in the DOM within its own cell — so a road
  // still paints over its own cell's scenery, while a canopy overhanging a
  // plain neighbour survives.
  z-index: 1;
}
.tile-canopy {
  // Above the rails (z2), the trains (wagons z3 / loco z4) AND the road cars
  // (z6): a crown overhanging a corridor shades whatever drives under it,
  // train or car alike. Crossings stay on top (their wrapper is z15), and the
  // cars' debug id labels can't leak through — each .road-car is its own
  // stacking context. Fare pins (z9) and switches (z14+) also stay above.
  z-index: 7;
}
// The mountain over a BORE, lifted above the trains — the same trick as the
// canopy, applied to the whole cell instead of a few crowns. This is what makes
// a tunnel work: the rock OCCLUDES the consist, so each unit slides out of
// sight along the tile edge instead of being switched off at the tile centre
// (which popped half a locomotive — the sprite is 100px of a 200px tile — into
// and out of existence in the middle of the ridge). The portal arch and the
// dashed guide are lifted over the roof in Tile.vue.
.tile-ground.tile-over-bore {
  z-index: 7;
}
.tile-scatter.tile-over-bore {
  // Above its own roof, as scatter always is above its own patch.
  z-index: 8;
}
</style>
