<template>
  <!-- HUD-anchored hints (the calendar row) teleport to <body>: the world
       container carries a CSS transform, which makes it the containing block
       for position:fixed descendants — a fixed bubble inside .level would pan
       and zoom with the board it is trying to stand apart from. -->
  <Teleport to="body" v-if="mark && hudRect">
    <div
      class="coach-mark coach-mark--hud"
      data-testid="coach-mark"
      :data-coach-id="mark.id"
      :data-coach-kind="mark.kind"
      :style="{
        left: `${hudRect.x}px`,
        top: `${hudRect.y}px`,
        transform: 'translate(-50%, 0)',
      }"
    >
      <div class="coach-mark__arrow coach-mark__arrow--up" />
      <div class="coach-mark__bubble">{{ mark.text }}</div>
    </div>
  </Teleport>
  <div
    v-else-if="mark && mark.anchor.kind !== 'hud'"
    class="coach-mark"
    data-testid="coach-mark"
    :data-coach-id="mark.id"
    :data-coach-kind="mark.kind"
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
// Fallback lift over a train's tile on boards without fare pins.
const HOME_LIFT = 0.3;
// Gap between a HUD slot element and the bubble below it, in screen px.
const HUD_GAP = 6;

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

  // The arrow tip's world position for world anchors. A train anchor rides
  // its fare badge (which the game refreshes each frame beside the sprite);
  // on boards whose mode draws no fares it falls back to the train's LIVE sim
  // tile, then to the authored home tile.
  get pos(): { x: number; y: number } {
    const ts = this.game.tileSize;
    const anchor = this.mark?.anchor;
    if (!anchor || anchor.kind === "hud") return { x: 0, y: 0 };
    if (anchor.kind === "train") {
      const badge = this.game.fareBadges.find(b => b.trainId === anchor.id);
      if (badge) return { x: badge.x, y: badge.y - ts * BADGE_LIFT };
      // The live position reads the markRaw'd sim — touch the heartbeat or
      // this computed is cached at its first answer for ever (KNOWHOW).
      void this.game.renderTick.value;
      const tileId =
        this.game.sim.trains[anchor.id] !== undefined
          ? this.game.sim.trainTileId(anchor.id)
          : anchor.homeTile;
      if (!tileId) return { x: 0, y: 0 };
      const { x, y } = parseCoordId(tileId);
      return { x: (x + 0.5) * ts, y: (y + 0.5 - HOME_LIFT) * ts };
    }
    const { x, y } = parseCoordId(anchor.id);
    return {
      x: (x + 0.5 + (anchor.dx ?? 0)) * ts,
      y: (y + 0.5 + (anchor.dy ?? 0) - TILE_LIFT) * ts,
    };
  }

  // Where a HUD-anchored bubble goes, in viewport px: centred under the slot
  // element the view tagged with data-coach-slot. Null hides the bubble (no
  // slot on this view — the hint still dwells out in the controller, which is
  // acceptable for chrome that genuinely is not on screen). Reads the DOM, so
  // it must touch the heartbeat to re-run each drawn frame.
  get hudRect(): { x: number; y: number } | null {
    const anchor = this.mark?.anchor;
    if (!anchor || anchor.kind !== "hud") return null;
    void this.game.renderTick.value;
    const el = document.querySelector(`[data-coach-slot="${anchor.slot}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.bottom + HUD_GAP };
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
// The HUD variant teleports to <body> and positions in screen space, above
// the game chrome it annotates — the score card and the drawers sit at
// 2000-3000, and a hint hiding behind the very row it points at teaches
// nothing (measured: the first-levy bubble's opening line vanished under the
// score card at a smaller z).
.coach-mark--hud {
  position: fixed;
  z-index: 3500;
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
.coach-mark__arrow--up {
  border-top: none;
  border-bottom: 10px solid #5fd39a;
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
