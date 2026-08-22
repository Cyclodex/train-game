<template>
  <div class="fx-layer" aria-hidden="true">
    <template v-for="f in fx" :key="`fx-${f.id}`">
      <div
        v-if="f.kind === 'delivery'"
        class="fx fx-delivery"
        :style="posStyle(f)"
        data-testid="fx-delivery"
      />
      <div
        v-else-if="f.kind === 'bounce'"
        class="fx fx-bounce"
        :style="posStyle(f)"
        data-testid="fx-bounce"
      />
      <div
        v-else
        class="fx fx-cash"
        :style="cashStyle(f)"
        data-testid="fx-cash"
      >
        +${{ amountLabel(f) }}
      </div>
    </template>
  </div>
</template>

<script lang="ts">
import { Vue, Component, Prop, toNative } from "vue-facing-decorator";
import { FeedbackFx } from "@/game";
import { parseCoordId } from "@/tiles/model";

// The board's transient feedback, rendered from `game.fx` (appended by the
// event drain, pruned by age in the frame loop — this component only draws):
//
//  - delivery: a soft green pulse ring on the depot that just took a train.
//  - bounce:   a red squash-flash on the depot a train just thudded off.
//  - cash:     the banked fare ("+$470") flying off toward the HUD's account.
//
// All world-space, absolutely positioned like the fare pins (a box-generating
// direct child of `.level` would become a grid ITEM and eat a tile cell — see
// KNOWHOW → RENDER LAYOUT). Every animation runs once (fill-mode keeps the end
// state invisible) and the game prunes the entry a beat later.
@Component
class FxLayer extends Vue {
  @Prop({ required: true }) fx!: FeedbackFx[];
  @Prop({ required: true }) tileSize!: number;
  // Where the cash chip flies to, in WORLD px — the view derives it from its
  // camera so the flight heads for the HUD's money card wherever the board is
  // panned. Null (e.g. a view without a money HUD) lets the chip float up in
  // place instead.
  @Prop({ default: null }) cashTarget!: { x: number; y: number } | null;

  private centreOf(f: FeedbackFx): { x: number; y: number } {
    const { x, y } = parseCoordId(f.tileId);
    return {
      x: (x + 0.5) * this.tileSize,
      y: (y + 0.5) * this.tileSize,
    };
  }

  // Position via left/top, NOT via an inline transform: the animations below
  // animate `transform`, and a CSS animation overrides the style attribute —
  // an inline translate would be discarded for the whole animation and every
  // effect would play at the layer's origin instead of on its depot.
  posStyle(f: FeedbackFx): Record<string, string> {
    const c = this.centreOf(f);
    return {
      left: `${c.x}px`,
      top: `${c.y}px`,
    };
  }

  cashStyle(f: FeedbackFx): Record<string, string> {
    const c = this.centreOf(f);
    // The flight vector, as CSS vars the keyframes read: toward the HUD when a
    // target is set, else a gentle drift straight up.
    const dx = this.cashTarget ? this.cashTarget.x - c.x : 0;
    const dy = this.cashTarget ? this.cashTarget.y - c.y : -this.tileSize * 0.9;
    return {
      ...this.posStyle(f),
      "--fly-x": `${dx}px`,
      "--fly-y": `${dy}px`,
    };
  }

  amountLabel(f: FeedbackFx): string {
    return Math.round(f.amount ?? 0).toLocaleString("en-US");
  }
}

export default toNative(FxLayer);
</script>

<style lang="scss" scoped>
.fx-layer {
  position: absolute;
  inset: 0;
  // Nothing here is a target; the board under it stays clickable.
  pointer-events: none;
}
.fx {
  position: absolute;
  // Over the board art (depots/trains sit at 10, signals 14) but under the
  // fare pins (30) — a chip must never cover the button it celebrates.
  z-index: 28;
}

// A green ring breathing out of the depot — the delivery landing.
.fx-delivery {
  width: 120px;
  height: 120px;
  border: 6px solid rgba(95, 211, 154, 0.9);
  border-radius: 50%;
  opacity: 0;
  animation: fx-delivery-ring 0.8s ease-out forwards;
}
@keyframes fx-delivery-ring {
  0% {
    opacity: 0.95;
    transform: translate(-50%, -50%) scale(0.35);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.25);
  }
}

// The mismatch: a red square squashing flat and recoiling, like the train
// hitting a wall — because that is what just happened.
.fx-bounce {
  width: 130px;
  height: 130px;
  border: 6px solid rgba(224, 49, 49, 0.85);
  border-radius: 18px;
  background: rgba(224, 49, 49, 0.18);
  opacity: 0;
  animation: fx-bounce-squash 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}
@keyframes fx-bounce-squash {
  0% {
    opacity: 0.9;
    transform: translate(-50%, -50%) scale(1, 1);
  }
  30% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.3, 0.6);
  }
  60% {
    transform: translate(-50%, -50%) scale(0.85, 1.15);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1, 1);
  }
}

// The banked fare, flying home to the account. Two beats: pop in on the depot,
// then away along the flight vector, shrinking as it goes.
.fx-cash {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(18, 22, 28, 0.92);
  color: #5fd39a;
  font: 800 20px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.45);
  opacity: 0;
  animation: fx-cash-fly 1.1s cubic-bezier(0.5, 0, 0.75, 0.6) forwards;
}
@keyframes fx-cash-fly {
  0% {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.4);
  }
  18% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1.15);
  }
  35% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -50%) translate(var(--fly-x), var(--fly-y)) scale(0.45);
  }
}
</style>
