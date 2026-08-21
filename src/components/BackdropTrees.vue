<template>
  <svg
    v-if="visible"
    class="backdrop-trees"
    :viewBox="`0 0 ${width} ${height}`"
    preserveAspectRatio="none"
    v-html="treesHtml()"
  />
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import { Level } from "@/tiles/model";
import { Corridor } from "@/tiles/terrain";
import {
  MEADOW_TILE,
  MEADOW_TREE_REACH,
  backdropCellOf,
  backdropCorridorsAt,
  backdropTreeFelledBy,
  backdropTreeHiddenBy,
  meadowTreeLayout,
} from "@/utils/meadowBackdrop";

// The meadow theme's scattered backdrop trees, as ONE world-sized overlay in
// the canopy z band — above the rails, the trains and the road cars, exactly
// like a forest crown overhanging a corridor (see TileGround's canopy layer).
// They used to be a repeating CSS background UNDER the board, which put every
// crown BEHIND the track it overlapped: a rail cutting through foliage reads
// as a defect, a train sliding under it reads as a wood.
//
// Mounted once per view inside `.level` (absolutely positioned, so it is not a
// grid item — see KNOWHOW → RENDER LAYOUT) and sized by the rendered grid, so
// it pans and zooms with the tiles the trees stand between. The layout is the
// same seeded 680px pattern the old texture tiled, repeated in world space —
// same seed, same trees, just on the right layer.
@Component({})
class BackdropTrees extends Vue {
  @Inject() level!: Level;
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  // The rendered grid, not `levelBounds`: the editor draws into a two-cell
  // margin beyond the level's own extents, and the trees have to cover it.
  @Prop({ type: Number, required: true }) cols!: number;
  @Prop({ type: Number, required: true }) rows!: number;

  // Only the meadow grows trees, and the debug flat backdrop strips them with
  // the rest of the theme (`npm run shot` relies on that for comparability).
  get visible(): boolean {
    return this.config.worldTheme === "meadow" && !this.config.plainBackdrop;
  }
  get width(): number {
    return this.cols * this.config.tileSize;
  }
  get height(): number {
    return this.rows * this.config.tileSize;
  }

  // A METHOD, not a getter (the TileGround.accessHtml lesson): this reads the
  // level, which the editor and the in-play build tools mutate live — painting
  // terrain over a tree has to swallow it on the next render.
  treesHtml(): string {
    const layout = meadowTreeLayout();
    const size = this.config.tileSize;
    const w = this.width;
    const h = this.height;
    // The right-of-way corridors, once per CELL rather than once per tree —
    // rebuilt per call, so laying track through the meadow fells its trees on
    // the next render.
    const corridorCache = new Map<string, Corridor[]>();
    const placed: { py: number; g: string }[] = [];
    // Every 680px pattern instance that can reach the board, including the
    // -1 row/column: a tree near an instance's far edge leans its crown into
    // the next one, which is what the old texture's wrapped copies were for.
    for (let j = -1; j * MEADOW_TILE < h + MEADOW_TREE_REACH; j++) {
      for (let i = -1; i * MEADOW_TILE < w + MEADOW_TREE_REACH; i++) {
        for (const t of layout) {
          const px = t.x + i * MEADOW_TILE;
          const py = t.y + j * MEADOW_TILE;
          if (px < -MEADOW_TREE_REACH || px > w + MEADOW_TREE_REACH) continue;
          if (py < -MEADOW_TREE_REACH || py > h + MEADOW_TREE_REACH) continue;
          // The cell the tree STANDS on decides whether it exists at all: a
          // lake drowns it, a town or a car park replaces it, a depot owns
          // its plot.
          const { cx, cy, local } = backdropCellOf(px, py, size);
          if (backdropTreeHiddenBy(this.level[`${cx},${cy}`])) continue;
          // The forest's right-of-way rule: a trunk standing IN a rail/road
          // corridor is felled, one beside it stays — and its crown, on this
          // canopy overlay, overhangs the traffic passing under it.
          const key = `${cx},${cy}`;
          let corridors = corridorCache.get(key);
          if (!corridors) {
            corridors = backdropCorridorsAt(this.level, cx, cy);
            corridorCache.set(key, corridors);
          }
          if (backdropTreeFelledBy(corridors, local)) continue;
          placed.push({
            py,
            g: `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})">${t.svg}</g>`,
          });
        }
      }
    }
    // Back to front, so a nearer canopy overlaps a farther one naturally.
    return placed
      .sort((a, b) => a.py - b.py)
      .map(p => p.g)
      .join("");
  }
}
export default toNative(BackdropTrees);
</script>

<style lang="scss" scoped>
.backdrop-trees {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  // The canopy band (see TileGround's .tile-canopy): above the rails (z2), the
  // wagons (z3) / loco (z4) and the road cars (z6); crossing furniture (z15),
  // fare pins (z9) and switches (z14+) stay on top. NO overflow: visible — the
  // svg clips at the board edge exactly as the old background texture did, so
  // no crown floats out over the framed backdrop.
  z-index: 7;
}
</style>
