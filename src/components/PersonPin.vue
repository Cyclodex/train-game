<template>
  <div
    v-if="fix"
    class="person-pin"
    :class="`person-pin--${fix.on}`"
    :style="{
      transform: `translate(-50%, -100%) translate(${fix.x}px, ${fix.y}px) scale(${counterScale})`,
      transformOrigin: '50% 100%',
    }"
    :title="`${name} — ${whereText}`"
  >
    <div class="person-pin__drop">
      <span class="person-pin__glyph">{{ glyph }}</span>
    </div>
    <div class="person-pin__name">{{ name }}</div>
  </div>
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, toNative } from "vue-facing-decorator";
import { Game, PersonFix } from "@/game";

// THE PIN — a big marker over one named person, so you can find them on a board
// with a hundred dots on it and watch them all the way to work.
//
// Positioned exactly like a road car or a walking figure: absolutely, inside
// `.level`, so it is not a grid ITEM and cannot displace a tile (KNOWHOW →
// RENDER LAYOUT). It reads `game.locatePerson` every frame, and that answer
// comes from the SIMS rather than the render mirror — so the pin is in the right
// place on the first frame it appears, instead of at the origin for one tick.
//
// The camera deliberately does NOT follow. Pinning is for finding somebody and
// keeping sight of them while you look at the rest of the board; hijacking the
// view would take the board away from the player at the exact moment they asked
// to watch it.

const GLYPH: Record<PersonFix["on"], string> = {
  foot: "🚶",
  car: "🚗",
  train: "🚆",
  platform: "🕒",
  indoors: "🏠",
};
const WHERE: Record<PersonFix["on"], string> = {
  foot: "on foot",
  car: "in a car",
  train: "on the train",
  platform: "waiting on the platform",
  indoors: "indoors",
};

@Component({})
class PersonPin extends Vue {
  @Inject() game!: Game;
  @Prop({ type: String, required: true }) personId!: string;
  /**
   * The camera's zoom. The pin lives INSIDE the scaled world, so at the 40% a
   * whole town is viewed at it would shrink to a speck — the opposite of a
   * marker whose job is "find this person on a busy board". Counter-scaling
   * keeps it the same size on screen at any zoom, capped so it does not become
   * a billboard when you zoom right in on one street.
   */
  @Prop({ type: Number, default: 1 }) zoom!: number;

  get fix(): PersonFix | null {
    // Touch the heartbeat FIRST: `locatePerson` reads the markRaw'd sims, so
    // without a reactive dependency this computed is evaluated once and the pin
    // never moves again. Measured exactly that way.
    void this.game.renderTick.value;
    return this.game.locatePerson(this.personId);
  }
  get counterScale(): number {
    return Math.min(1, 1 / Math.max(this.zoom, 0.01));
  }
  get name(): string {
    return this.game.inspectPerson(this.personId)?.name ?? "";
  }
  get glyph(): string {
    return this.fix ? GLYPH[this.fix.on] : "";
  }
  get whereText(): string {
    return this.fix ? WHERE[this.fix.on] : "";
  }
}
export default toNative(PersonPin);
</script>

<style lang="scss" scoped>
.person-pin {
  position: absolute;
  top: 0;
  left: 0;
  // Above the cars and the walkers (z6) and the canopy (z7), below the HUD:
  // the whole point is that nothing on the board hides it.
  z-index: 12;
  pointer-events: none;
  will-change: transform;
  display: flex;
  flex-direction: column;
  align-items: center;
}
// The teardrop. A square rotated 45° with three corners rounded is the classic
// map-pin silhouette and needs no SVG.
.person-pin__drop {
  width: 52px;
  height: 52px;
  border-radius: 50% 50% 50% 4px;
  transform: rotate(45deg);
  background: linear-gradient(145deg, #ffd166, #f0932b);
  border: 3px solid rgba(30, 22, 10, 0.75);
  box-shadow: 0 6px 14px rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
  animation: person-pin-bob 1.6s ease-in-out infinite;
}
.person-pin__glyph {
  transform: rotate(-45deg); // cancel the drop's rotation
  font-size: 24px;
  line-height: 1;
}
.person-pin__name {
  margin-top: 2px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(18, 20, 24, 0.85);
  color: #ffe9b8;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}
// A gentle bob, so the eye catches it on a busy board without it flashing.
@keyframes person-pin-bob {
  0%,
  100% {
    transform: rotate(45deg) translateY(0);
  }
  50% {
    transform: rotate(45deg) translateY(-4px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .person-pin__drop {
    animation: none;
  }
}
</style>
