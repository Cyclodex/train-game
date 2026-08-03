<template>
  <aside v-if="plot || person" class="inspector">
    <button class="inspector__close" title="Close" @click="$emit('close')">×</button>

    <!-- A PLOT: what it is, and who is on it. The way in from the board. -->
    <template v-if="plot && !person">
      <h3 class="inspector__title">
        {{ kindLabel }} <span class="inspector__coord">{{ plot.id }}</span>
      </h3>
      <p class="inspector__sub">
        {{ plot.city }} · {{ plot.people }}/{{ plot.capacity }}
        {{ plot.kind === "home" ? "residents" : "jobs filled" }}
      </p>
      <ul class="inspector__roll">
        <li v-for="p in plot.residents" :key="p.id">
          <button class="inspector__person" @click="show(p.id)">
            <span class="inspector__name">{{ p.name }}</span>
            <span class="inspector__doing">{{ p.doing }}</span>
            <span class="inspector__mood" :style="{ opacity: 0.35 + p.mood * 0.65 }">
              {{ moodFace(p.mood) }}
            </span>
          </button>
        </li>
        <li v-if="plot.residents.length === 0" class="inspector__empty">Nobody here yet.</li>
      </ul>
    </template>

    <!-- A PERSON: their day, and the choice behind their commute. -->
    <template v-if="person">
      <h3 class="inspector__title">
        {{ person.name }}
        <span class="inspector__mood">{{ moodFace(person.mood) }}</span>
      </h3>
      <!-- Drop a big marker on them and keep it there. A toggle, not a mode:
           click it again and the pin is gone. Its own row rather than floated
           into the heading, which put it under the close button. -->
      <button
        class="inspector__pin"
        :class="{ 'is-on': pinned === person.id }"
        :title="pinned === person.id ? 'Remove the pin' : 'Pin ' + person.name + ' on the board'"
        @click="togglePin(person.id)"
      >
        📍 {{ pinned === person.id ? "Pinned — click to remove" : "Pin them on the board" }}
      </button>
      <p class="inspector__sub">
        lives {{ person.home }} ·
        <template v-if="person.work">works {{ person.work }}</template>
        <template v-else>no job</template>
        · {{ person.carOwner ? "owns a car" : "no car" }}
      </p>

      <!-- The day. Fixed times, rolled once when they moved in. -->
      <ul class="inspector__day">
        <li><b>{{ person.leavesAt }}</b> leaves for work</li>
        <li><b>{{ person.shopsAt }}</b> runs an errand</li>
        <li><b>{{ person.returnsAt }}</b> heads home</li>
      </ul>

      <p class="inspector__now">
        <b>Now:</b> {{ person.doing }}
        <span v-if="person.elapsedSec !== null" class="inspector__timing">
          {{ dur(person.elapsedSec) }} in, and they reckon it should take
          {{ dur(person.expectedSec ?? 0) }}.
        </span>
      </p>
      <p v-if="person.unhappyDays > 0" class="inspector__warn">
        Unhappy {{ person.unhappyDays }} day{{ person.unhappyDays === 1 ? "" : "s" }} running —
        thinking of leaving.
      </p>

      <!-- WHY. A mood is not actionable; the journey behind it is. -->
      <template v-if="person.recent.length">
        <h4 class="inspector__h4">Recent journeys</h4>
        <ul class="inspector__log">
          <li
            v-for="(n, i) in person.recent"
            :key="i"
            :class="{ 'is-bad': !n.good }"
          >
            <span class="inspector__delta">{{ n.delta >= 0 ? "+" : "" }}{{ n.delta.toFixed(2) }}</span>
            {{ n.text }}
          </li>
        </ul>
      </template>

      <!-- THE COMPARISON. Every way of making this journey, priced. -->
      <h4 class="inspector__h4">
        {{ person.travellingTo ? "This journey" : "Their commute" }}, every way
      </h4>
      <table class="inspector__modes">
        <tr v-for="m in modes" :key="m.mode" :class="{ 'is-chosen': m.chosen, 'is-off': !!m.why }">
          <td class="inspector__mode">{{ icon(m.mode) }} {{ label(m.mode) }}</td>
          <td class="inspector__time" :title="m.why ? '' : `${m.boardLabel} on the board`">
            {{ m.why ? "—" : m.label }}
          </td>
          <td class="inspector__note">
            <template v-if="m.why">{{ m.why }}</template>
            <template v-else-if="m.chosen">chosen</template>
            <template v-else-if="feels(m)">feels like {{ feels(m) }}</template>
          </td>
        </tr>
      </table>
      <p v-if="modes.length > 0 && !modes.some(m => m.chosen)" class="inspector__stranded">
        No way to make this journey at all — they give up, and the city's
        <b>access</b> score takes it.
      </p>
      <p class="inspector__foot">
        Journey times are on the town's own clock, the same one at the top of
        the card. They pick the one that <i>feels</i> shortest — a long walk
        drags, and how much depends on the person.
      </p>
      <button v-if="plot" class="inspector__back" @click="personId = null">‹ back to {{ plot.id }}</button>
    </template>
  </aside>
</template>

<script lang="ts">
import { Component, Inject, Prop, Vue, Watch, toNative } from "vue-facing-decorator";
import { Game, ModeCompare, PersonCard, PlotCard } from "@/game";
import { TravelMode } from "@/sim/citizens";

// THE INSPECTOR — click a house, click a person, see their day and the choice
// behind their commute.
//
// A pure view over `game.inspectPlot` / `inspectPerson` / `compareModes`, all of
// which build their answer on demand. Nothing here is stored in the game and
// nothing is stepped, so an open panel costs a rebuild per frame and a closed
// one costs nothing at all.
//
// The mode table is the point of it. It is NOT a re-derivation of "what would
// they have done" — it is the very list `chooseMode` compares, handed straight
// out of the sim, so the panel and the decision cannot drift apart.

const MODE_LABEL: Record<TravelMode, string> = {
  walk: "Walk",
  car: "Drive",
  transit: "Train",
  parkAndRide: "Park & ride",
};
const MODE_ICON: Record<TravelMode, string> = {
  walk: "🚶",
  car: "🚗",
  transit: "🚆",
  parkAndRide: "🅿️",
};

@Component({ emits: ["close", "pin"] })
class CitizenInspector extends Vue {
  @Inject() game!: Game;
  /** The plot the player clicked, if any. */
  @Prop({ type: String, default: null }) plotId!: string | null;
  /** A person clicked directly on the board (a figure on the pavement). */
  @Prop({ type: String, default: null }) focusId!: string | null;
  /** Who currently has a pin on them, so the button can read as a toggle. */
  @Prop({ type: String, default: null }) pinned!: string | null;

  // The person being read, when one was picked out of a plot's roll call.
  personId: string | null = null;

  @Watch("plotId")
  onPlot(): void {
    this.personId = null;
  }

  // All three of these read the markRaw'd sims on demand, so each one has to
  // touch the render heartbeat or Vue caches the first answer and the card
  // freezes on whatever the person was doing when it opened.
  get plot(): PlotCard | null {
    void this.game.renderTick.value;
    return this.plotId ? this.game.inspectPlot(this.plotId) : null;
  }

  get person(): PersonCard | null {
    void this.game.renderTick.value;
    const id = this.focusId ?? this.personId;
    return id ? this.game.inspectPerson(id) : null;
  }

  get modes(): ModeCompare[] {
    void this.game.renderTick.value;
    return this.person ? this.game.compareModes(this.person.id) : [];
  }

  get kindLabel(): string {
    const k = this.plot?.kind;
    return k === "home" ? "Houses" : k === "shop" ? "Shops" : "Workplace";
  }

  show(id: string): void {
    this.personId = id;
  }

  // The view owns the pin, not the panel: the marker lives on the board, and
  // it must survive the panel being closed — you pin somebody precisely so you
  // can put the card away and watch them.
  togglePin(id: string): void {
    this.$emit("pin", this.pinned === id ? null : id);
  }

  label(m: TravelMode): string {
    return MODE_LABEL[m];
  }
  icon(m: TravelMode): string {
    return MODE_ICON[m];
  }
  // The game binds its own day length, so the panel never has to know it.
  dur(sec: number): string {
    return this.game.durationLabel(sec);
  }

  // How much this person's habits stretch or shrink the honest estimate. Shown
  // only when it actually differs — an identical number twice reads as a bug.
  feels(m: ModeCompare): string | null {
    if (m.seconds === null || m.perceivedSeconds === null) return null;
    // Only when it differs by enough to PRINT differently — the same string
    // twice reads as a bug.
    if (this.game.durationLabel(m.perceivedSeconds) === this.game.durationLabel(m.seconds))
      return null;
    return this.game.durationLabel(m.perceivedSeconds);
  }

  moodFace(mood: number): string {
    return mood > 0.66 ? "🙂" : mood > 0.33 ? "😐" : "🙁";
  }
}
export default toNative(CitizenInspector);
</script>

<style lang="scss" scoped>
.inspector {
  position: absolute;
  // BOTTOM-left, deliberately: the city cards own the top-right corner in both
  // views, and a panel that lands on top of them hides the very numbers it is
  // explaining. Left rather than right so the zoom controls stay reachable.
  left: 12px;
  bottom: 12px;
  z-index: 2100;
  width: 280px;
  max-height: min(70vh, calc(100% - 24px));
  overflow-y: auto;
  padding: 12px 14px 14px;
  border-radius: 12px;
  background: rgba(18, 20, 24, 0.9);
  backdrop-filter: blur(8px);
  color: #e9edf2;
  font-size: 12px;
  line-height: 1.45;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.inspector__close {
  position: absolute;
  top: 6px;
  right: 8px;
  border: 0;
  background: none;
  color: #8b949e;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  &:hover {
    color: #e9edf2;
  }
}
.inspector__title {
  margin: 0 0 2px;
  font-size: 14px;
  font-weight: 600;
}
.inspector__pin {
  display: block;
  width: 100%;
  margin: 8px 0 2px;
  padding: 5px 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: none;
  color: #9aa4b0;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  &:hover {
    color: #e9edf2;
    border-color: rgba(255, 255, 255, 0.35);
  }
  &.is-on {
    color: #1a1408;
    background: #ffd166;
    border-color: #ffd166;
  }
}
.inspector__coord {
  color: #8b949e;
  font-weight: 400;
  font-size: 11px;
}
.inspector__sub {
  margin: 0 0 10px;
  color: #9aa4b0;
  font-size: 11px;
}
.inspector__roll {
  margin: 0;
  padding: 0;
  list-style: none;
}
.inspector__person {
  display: flex;
  gap: 8px;
  align-items: baseline;
  width: 100%;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  &:hover {
    background: rgba(255, 255, 255, 0.08);
  }
}
.inspector__name {
  font-weight: 600;
  min-width: 52px;
}
.inspector__doing {
  flex: 1;
  color: #9aa4b0;
  font-size: 11px;
}
.inspector__empty {
  color: #6e7681;
  padding: 4px 6px;
}
.inspector__day {
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
  color: #c4ccd6;
  li {
    display: flex;
    gap: 8px;
    white-space: nowrap;
  }
  b {
    flex: 0 0 auto;
    min-width: 38px;
    font-variant-numeric: tabular-nums;
  }
}
.inspector__timing {
  display: block;
  color: #9aa4b0;
  font-size: 11px;
}
.inspector__now {
  margin: 0 0 4px;
}
.inspector__log {
  margin: 0;
  padding: 0;
  list-style: none;
  color: #9aa4b0;
  font-size: 11px;
  li {
    display: flex;
    gap: 6px;
    padding: 2px 0;
  }
  .is-bad {
    color: #e6a08a;
  }
}
.inspector__delta {
  flex: 0 0 auto;
  min-width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  opacity: 0.85;
}
.inspector__warn {
  margin: 0 0 8px;
  color: #ffb020;
}
.inspector__h4 {
  margin: 12px 0 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #8b949e;
}
.inspector__modes {
  width: 100%;
  border-collapse: collapse;
  td {
    padding: 3px 0;
    vertical-align: baseline;
  }
}
.inspector__mode {
  white-space: nowrap;
}
.inspector__time {
  text-align: right;
  padding-right: 8px !important;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.inspector__note {
  color: #8b949e;
  font-size: 11px;
}
// The winner. The one row the eye should land on.
.is-chosen {
  color: #58d68d;
  .inspector__note {
    color: #58d68d;
  }
}
// Not on offer at all — dimmed, but still listed, because "why not" is half the
// answer a planner is looking for.
.is-off {
  opacity: 0.5;
}
// Nothing on offer: the strongest signal the model has, and the one thing a
// planner most needs said out loud rather than left as an empty table.
.inspector__stranded {
  margin: 8px 0 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(240, 80, 60, 0.16);
  color: #ff8a70;
}
.inspector__foot {
  margin: 10px 0 0;
  color: #6e7681;
  font-size: 10.5px;
  line-height: 1.4;
}
.inspector__back {
  margin-top: 10px;
  border: 0;
  background: none;
  color: #58a6ff;
  font: inherit;
  cursor: pointer;
  padding: 0;
}
</style>
