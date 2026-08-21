<template>
  <div
    v-if="mark"
    class="coach-mark"
    data-testid="coach-mark"
    :data-coach-id="mark.id"
    :style="{
      transform: `translate(-50%, -100%) translate(${pos.x}px, ${pos.y}px) scale(${counterScale})`,
      transformOrigin: '50% 100%',
    }"
  >
    <div class="coach-mark__bubble">{{ mark.text }}</div>
    <div class="coach-mark__arrow" />
  </div>
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { Game } from "@/game";
import { CoachActive } from "@/coach";
import { parseCoordId } from "@/tiles/model";

// One coach-mark bubble, floating over the board object it teaches (the
// Train Valley anchoring rule — a hint in a corner is a manual, a hint on the
// object is a lesson; see src/coach.ts). Positioned like a fare pin:
// absolutely, inside `.level`, so it is not a grid ITEM and cannot displace a
// tile (KNOWHOW → RENDER LAYOUT). PlayView and TestStage both mount it, which
// is why it is a component rather than markup in a view.
//
// pointer-events is NONE, and that is load-bearing: a mark is dismissed by
// DOING the thing it points at, so the bubble must never swallow the click
// that would dismiss it.

// How far above a tile's centre the arrow tip sits, in tile units.
const TILE_LIFT = 0.18;
// How far above a fare badge (which already floats over its loco) the tip
// sits, so the bubble clears the pin it points past.
const BADGE_LIFT = 0.24;
// Fallback lift over a train's home tile on boards without fare pins.
const HOME_LIFT = 0.3;

@Component({})
class CoachMark extends Vue {
  @Inject() game!: Game;
  // The camera's zoom, for counter-scaling: the mark lives INSIDE the scaled
  // world and its job is to be read, so it keeps its screen size at any zoom
  // (same reasoning as PersonPin, capped the same way).
  @Prop({ type: Number, default: 1 }) zoom!: number;

  get mark(): CoachActive | null {
    return this.game.coach.active;
  }

  get counterScale(): number {
    return Math.min(1, 1 / Math.max(this.zoom, 0.01));
  }

  // The arrow tip's world position. A train anchor rides its fare badge (which
  // the game refreshes each frame beside the sprite) and falls back to the
  // train's home tile on boards whose mode draws no fares.
  get pos(): { x: number; y: number } {
    const ts = this.game.tileSize;
    const anchor = this.mark?.anchor;
    if (!anchor) return { x: 0, y: 0 };
    if (anchor.kind === "train") {
      const badge = this.game.fareBadges.find(b => b.trainId === anchor.id);
      if (badge) return { x: badge.x, y: badge.y - ts * BADGE_LIFT };
      const { x, y } = parseCoordId(anchor.homeTile);
      return { x: (x + 0.5) * ts, y: (y + 0.5 - HOME_LIFT) * ts };
    }
    const { x, y } = parseCoordId(anchor.id);
    return {
      x: (x + 0.5 + (anchor.dx ?? 0)) * ts,
      y: (y + 0.5 + (anchor.dy ?? 0) - TILE_LIFT) * ts,
    };
  }
}

export default toNative(CoachMark);
</script>

<style lang="scss" scoped>
.coach-mark {
  position: absolute;
  top: 0;
  left: 0;
  // Above the fare pins (30) it may point past, below the depot colour dot
  // (1000) — the same band the rest of the board chrome lives in.
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: center;
  // Never between the player and the thing being taught: the action IS the
  // dismissal, so the click must land on the board underneath.
  pointer-events: none;
  animation: coach-mark-float 2.4s ease-in-out infinite;
}
.coach-mark__bubble {
  max-width: 240px;
  padding: 9px 13px;
  border: 2px solid #5fd39a;
  border-radius: 12px;
  background: rgba(18, 22, 28, 0.94);
  color: #f2f6f4;
  font: 600 14px/1.35 ui-sans-serif, system-ui, -apple-system, Segoe UI,
    sans-serif;
  text-align: center;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}
.coach-mark__arrow {
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
  border-top: 10px solid #5fd39a;
}
@keyframes coach-mark-float {
  0%,
  100% {
    margin-top: 0;
  }
  50% {
    margin-top: -6px;
  }
}
</style>
