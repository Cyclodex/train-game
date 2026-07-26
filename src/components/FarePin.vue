<template>
  <button
    class="fare-pin"
    :class="{
      'fare-pin--waiting': badge.waiting,
      'fare-pin--held': !!badge.held,
    }"
    :style="pinStyle"
    :title="title"
    data-testid="fare-pin"
    @click.stop="$emit('send')"
  >
    <span class="fare-pin__amount">{{ badge.amount }}</span>
    <span v-if="badge.waiting" class="fare-pin__go">▶</span>
    <template v-else-if="badge.held">
      <span class="fare-pin__hold">‖</span>
      <span class="fare-pin__blocker" data-testid="fare-pin-blocker">
        {{ blockerLabel }}
      </span>
    </template>
  </button>
</template>

<script lang="ts">
import { Vue, Component, Prop, toNative } from "vue-facing-decorator";
import { FareBadge } from "@/game";

// The money HUD's ONLY board chrome: one pin per live train, floating over its
// loco and coloured by its livery so it names its train without text (design doc
// §5.5). It has three states, and the third is the reason this is a component
// rather than markup inlined in a view — PlayView and TestStage both draw it, and
// they used to carry a byte-identical copy each (with a comment conceding that
// scoped styles "cannot be shared as-is"; a component can).
//
//  - waiting: sitting in its station, fare already falling. The pin IS the
//    dispatch button, and pulses to say so.
//  - held: dispatched, but standing still because the block ahead belongs to
//    somebody else. Our interlocking reserves the whole route to the next signal,
//    so a train can refuse to leave its platform for a stretch of track it is
//    nowhere near — which, unexplained, reads as a broken game. The pin names the
//    culprit and rings itself in THAT train's livery, so the answer to "why is it
//    not moving" is on the train, not buried in the activity log.
//  - rolling: just a fare, counting down.
@Component({ emits: ["send"] })
class FarePin extends Vue {
  @Prop({ required: true }) badge!: FareBadge;

  // A hold with no train behind it (the player's own signal) has no livery to
  // borrow, so it falls back to the HUD's amber rather than picking a colour
  // that would falsely name a train.
  private static readonly NEUTRAL_HOLD = "#f0b542";

  get holdColor(): string {
    return this.badge.held?.color ?? FarePin.NEUTRAL_HOLD;
  }

  get pinStyle(): Record<string, string> {
    const style: Record<string, string> = {
      borderColor: this.badge.color,
      transform: `translate(-50%, -50%) translate(${this.badge.x}px, ${this.badge.y}px)`,
    };
    if (this.badge.held) style["--hold-color"] = this.holdColor;
    return style;
  }

  // Who to point at. Train ids on these boards are short and meaningful (they
  // are usually the livery's colour name), so the id itself is the label.
  get blockerLabel(): string {
    const held = this.badge.held;
    if (!held) return "";
    if (held.by) return held.by;
    return held.reason === "signal-hold" ? "your signal" : "the block ahead";
  }

  get title(): string {
    if (this.badge.waiting) return "Waiting — click to send this train";
    const held = this.badge.held;
    if (!held) return "Fare, falling";
    if (held.reason === "signal-hold") return "Held at your own signal";
    return `Held — the track ahead is taken by ${this.blockerLabel}`;
  }
}

export default toNative(FarePin);
</script>

<style lang="scss" scoped>
.fare-pin {
  position: absolute;
  // Above every piece of board art it can land on: cars (6/7), train sprites and
  // depot buildings (both 10), signals (14), crossing booms (15), switch boxes
  // (20). It used to sit at 8, which put it UNDER the depot roof and under the
  // train it belongs to — invisible in exactly the situation that matters most,
  // a train sitting in its shed, which is where a waiting pin always is and
  // where a held one usually is. Still below the depot's own colour dot (1000),
  // so that click target is never swallowed.
  z-index: 30;
  top: 0;
  left: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 13px;
  border: 3px solid #fff;
  border-radius: 999px;
  background: rgba(18, 22, 28, 0.9);
  color: #f4d47a;
  font: 800 16px/1 ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.45);
  cursor: default;
}
.fare-pin--waiting {
  cursor: pointer;
  animation: fare-pin-pulse 1.4s ease-in-out infinite;

  &:hover {
    background: rgba(38, 50, 62, 0.95);
  }
}
// The held pin wears a second ring in its BLOCKER's livery — the whole point of
// the state: two rings, and the outer one tells you whose fault it is. It pulses
// slower and dimmer than the waiting pin, which is inviting a click; this one is
// only explaining itself.
.fare-pin--held {
  animation: fare-pin-held-pulse 2.2s ease-in-out infinite;
}
.fare-pin__go {
  color: #5fd39a;
  font-size: 13px;
}
.fare-pin__hold {
  color: var(--hold-color);
  font-size: 14px;
}
.fare-pin__blocker {
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--hold-color);
  font-size: 13px;
  font-weight: 800;
}
@keyframes fare-pin-pulse {
  0%,
  100% {
    box-shadow: 0 3px 12px rgba(0, 0, 0, 0.45);
  }
  50% {
    box-shadow: 0 3px 18px rgba(95, 211, 154, 0.65);
  }
}
@keyframes fare-pin-held-pulse {
  0%,
  100% {
    box-shadow:
      0 0 0 3px var(--hold-color),
      0 3px 12px rgba(0, 0, 0, 0.45);
  }
  50% {
    box-shadow:
      0 0 0 6px var(--hold-color),
      0 3px 12px rgba(0, 0, 0, 0.45);
  }
}
</style>
