<template>
  <svg
    v-if="html"
    :class="`tile-${layer}`"
    :viewBox="`0 0 ${units} ${units}`"
    preserveAspectRatio="none"
    v-html="html"
  />
  <!-- A bore's ROOF: the same art a SECOND time, clipped to the tile and lifted
       above the trains. A copy rather than a lift, because the layer below still
       has to draw the mountain's real, bowed-out silhouette — clip THAT and the
       ridge grows a flat spot per bored tile and the tile grid is back. See
       .tile-roof. -->
  <svg
    v-if="overBore && baseHtml"
    :class="[`tile-${layer}`, 'tile-roof']"
    :viewBox="`0 0 ${units} ${units}`"
    preserveAspectRatio="none"
    v-html="baseHtml"
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
  Elevation,
  GROUND_UNITS,
  HeightNeighbours,
  TerrainNeighbours,
  corridorsFor,
  terrainOf,
  tileCanopySvg,
  tileGroundSvg,
  tileScatterSvg,
} from "@/tiles/terrain";
import { accessPathSvg, accessPortOf } from "@/tiles/access";
import { crossingPaths, pavementPaths } from "@/tiles/footway";

// The world's ground, one tile at a time. A sibling of <Tile> rather than a
// layer inside it, because ground exists whether or not anything is built on the
// cell: a lake tile carries no track, and the grass between two spurs is still
// somewhere. The view already renders a `.level-tile` box for every cell in the
// bounds — occupied or not — so that box is exactly the right place for it.
//
// LAYERS, chosen by the `layer` prop, and views mount one of each per cell:
//  - "ground" (default): the flat patch, rim and ground marks — under
//    everything (z0).
//  - "paving": the man-made hard standing — the driveway between a plot and its
//    street, and the pavement beside the street — at z1, ABOVE every tile's
//    patch fill. Same reason the scatter split exists, and it took the same
//    bug to find: a patch's corners are jittered OFF the tile grid on purpose,
//    so a plot's ground legitimately spills a few units into the road tile
//    beside it. Painted in the same z band as that road tile's pavement, DOM
//    order decides — and the later tile won, chewing a notch out of the
//    pavement at EVERY tile seam. A pavement that stops short of the boundary
//    is not a pavement; it is a row of paving slabs.
//  - "scatter": the standing objects (trees, buildings, boulders, ridges) at
//    z1, ABOVE every tile's patch fill. The split exists because tiles render
//    in DOM order: a later tile's opaque patch used to decapitate any canopy
//    that legitimately overhung the seam. With all patches below all scatter,
//    an overhanging crown survives — which is also what lets deep-forest trees
//    stand right on a shared seam. Still under roads/rails (later DOM, z>=1).
//  - "markings": paint ON the tarmac (the zebra), above the road surface (z2).
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
  @Prop({ type: String, default: "ground" })
  layer!: "ground" | "paving" | "scatter" | "canopy" | "markings";

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

  // How high this cell stands and how far the ground falls around it, handed to
  // the ground build so it can lay the terraces IN its own art — over the
  // terrain patch's fill, under the detail drawn on it (see `Elevation`). It
  // used to be a separate fragment composed here, before the terrain, which is
  // why only grass ever looked elevated: every other kind paints an opaque
  // patch straight over it.
  //
  // The neighbours are handed over as HEIGHTS, not as "same" booleans: a cell
  // draws one contour per level it stands above its lowest neighbour, so a
  // summit dropping two or three steps at once draws the intermediate contours
  // inside its own tile instead of showing a single sheer wall. See
  // tileHeightSvg.
  get elevation(): Elevation | undefined {
    const h = heightOf(this.level[this.coordId]);
    if (h === 0) return undefined;
    const { x, y } = parseCoordId(this.coordId);
    const at = (dx: number, dy: number) =>
      heightOf(this.level[getCoordinatesId({ x: x + dx, y: y + dy })]);
    const around: HeightNeighbours = {
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
    // plainBackdrop on by default. (Only grass reads the theme: every other
    // ground anchors its terrace to its OWN colour.)
    const theme = this.config.plainBackdrop ? "plain" : this.config.worldTheme;
    return { height: h, around, theme };
  }

  // The LOCAL ACCESS path: the bit of ground between a plot and the street that
  // serves it. Derived, never authored (see tiles/access.ts) — the player lays
  // the arterial network and the last block draws itself.
  //
  // A METHOD, not a getter: a class getter is a cached computed in
  // vue-facing-decorator, and this reads the level, which the build tool edits
  // live. Cached, a street laid in play would never grow its paths.
  private accessHtml(): string {
    const port = accessPortOf(this.level, this.coordId);
    if (port === null) return "";
    const kind = terrainOf(this.level[this.coordId]);
    return accessPathSvg(port, this.coordId, kind === "industry" ? "industry" : "urban");
  }

  // A BORED cell gets its ground and scatter a SECOND time, above the trains:
  // the mountain over a tunnel is a ROOF, so a consist is covered by the rock
  // rather than switched off (see the .tile-roof rule). The canopy layer is
  // already above the trains and stays where it is.
  //
  // Safe because a bore only ever exists on tunnelable ground (`addConnection`
  // sets `TileCell.tunnel` exactly where `needsTunnel` holds — rock/mountain),
  // and those kinds paint an opaque patch that covers the whole tile. A bore
  // hand-authored onto grass would have no roof, and its train would drive over
  // the top in plain sight — which is the right way for invalid data to read.
  // Only the two layers that draw the mountain itself get a roof copy — those
  // are also the only two the `.tile-roof` rules give a z-index to. Paving and
  // markings carry no terrain art, and a roof copy of them would re-draw the
  // whole ridge at their z instead.
  get overBore(): boolean {
    return (
      (this.layer === "ground" || this.layer === "scatter") &&
      this.level[this.coordId]?.tunnel === true
    );
  }

  // The tile's own art for this layer — the ground layer INCLUDING its
  // terraces, so a bored tile's roof copy carries the same lighter step the
  // ground beneath it does (a mountain that terraces below the trains and not
  // above them would show a seam at every portal). The duplicated clipPath ids
  // that costs are harmless: both copies define the identical geometry, which
  // is already true of the patch's own `terrain-clip`.
  get baseHtml(): string {
    const kind = terrainOf(this.level[this.coordId]);
    if (this.layer === "canopy")
      return tileCanopySvg(kind, this.coordId, this.neighbours, TERRAIN_SEED, this.corridors);
    if (this.layer === "scatter")
      return tileScatterSvg(kind, this.coordId, this.neighbours, TERRAIN_SEED, this.corridors);
    return tileGroundSvg(
      kind,
      this.coordId,
      this.neighbours,
      TERRAIN_SEED,
      this.corridors,
      this.elevation,
    );
  }

  get html(): string {
    // Road markings painted ON the tarmac: the zebra. Its own layer because the
    // road surface is drawn above the ground, so a crossing on the ground layer
    // would be buried under the carriageway it is painted on.
    if (this.layer === "markings") return crossingPaths(this.level[this.coordId], this.units);
    // The hard standing: the driveway first, then the pavement it runs into, so
    // the kerb reads as the edge of the street rather than of the drive. Above
    // every tile's patch (see the layer notes), below the road surface and the
    // buildings, and a long way below the people walking on it.
    if (this.layer === "paving")
      return this.accessHtml() + pavementPaths(this.level[this.coordId], this.units);
    return this.baseHtml;
  }
}
export default toNative(TileGround);
</script>

<style lang="scss" scoped>
.tile-ground,
.tile-paving,
.tile-scatter,
.tile-canopy,
.tile-markings {
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
.tile-paving {
  // Above EVERY tile's patch, not just its own — that is the whole point of the
  // layer, and it is what makes a pavement continuous across a seam. Mounted
  // before the scatter, so within a cell a building still stands on its drive.
  z-index: 1;
}
.tile-scatter {
  // Above every tile's patch (z0), below the rails (z2). Same z as a road
  // surface, but the road is later in the DOM within its own cell — so a road
  // still paints over its own cell's scenery, while a canopy overhanging a
  // plain neighbour survives.
  z-index: 1;
}
.tile-markings {
  // Above the road surface (z1), below the trains and the cars: paint on the
  // tarmac. A zebra on a level crossing therefore sits under the rails, which
  // is the right way round.
  z-index: 2;
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
.tile-roof {
  // CLIPPED TO THE TILE, unlike every other ground layer. The patch keeps to
  // its own tile now, but the soft FRINGE deliberately does not — it is half a
  // stroke of the patch's own colour spilled onto the neighbour, and lifted
  // above the trains it would wash a passing consist in mountain grey a good
  // ten units before the portal. The original underneath still lays that
  // fringe, where it belongs and under everything. What is left after the clip
  // covers exactly the tile, and the portal's covered stretch reaches the tile
  // edge to meet it.
  clip-path: inset(0);
}
.tile-ground.tile-roof {
  z-index: 7;
}
.tile-scatter.tile-roof {
  // Above its own roof, as scatter always is above its own patch.
  z-index: 8;
}
</style>
