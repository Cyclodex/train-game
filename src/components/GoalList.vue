<script lang="ts">
import { Component, Prop, Vue, toNative } from "vue-facing-decorator";
import { GoalSpec } from "@/sim/objectives";

// The board's goals, listed with their targets. Used twice: on the Ready card
// (what you are aiming at) and on the win card (what you got).
//
// The API is deliberately shaped so the Ready card CANNOT light a star by
// accident. Earned-ness is not a boolean prop to be passed the wrong way round;
// it is an explicit list of ids, and the Ready card simply passes nothing. That
// matters because a star's predicate is evaluated over zeroed counters before
// the run starts, and most goals hold trivially there — "no signal was
// overridden" and "no train went to the wrong station" are both true of a run
// that has not happened yet.
@Component
class GoalList extends Vue {
  @Prop({ type: Array, required: true }) goals!: GoalSpec[];
  // Ids of the goals actually achieved. Omitted on the Ready card.
  @Prop({ type: Array, default: () => [] }) earned!: string[];

  isEarned(id: string): boolean {
    return this.earned.includes(id);
  }
}
export default toNative(GoalList);
</script>

<template>
  <ul class="goal-list" data-testid="goal-list">
    <li
      v-for="g in goals"
      :key="g.id"
      class="goal"
      :class="{ 'goal--earned': isEarned(g.id) }"
      :data-goal-id="g.id"
    >
      <span class="goal-pip">{{ isEarned(g.id) ? "★" : "☆" }}</span>
      <span class="goal-text">
        <span class="goal-label">{{ g.label }}</span>
        <span v-if="g.hint" class="goal-hint">{{ g.hint }}</span>
      </span>
    </li>
  </ul>
</template>

<style lang="scss" scoped>
.goal-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  // Left-aligned inside a centred card: a list of targets is read line by line,
  // and centred rows make the pips wander.
  text-align: left;
}

.goal {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.goal-pip {
  font-size: 15px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.28);
  flex: 0 0 auto;
}

.goal--earned .goal-pip {
  color: #f0cf72;
}

.goal-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.goal-label {
  font-size: 13px;
  font-weight: 600;
  color: #dbe3ea;
}

.goal--earned .goal-label {
  color: #f0cf72;
}

.goal-hint {
  font-size: 11px;
  line-height: 1.35;
  color: #8d99a4;
}
</style>
