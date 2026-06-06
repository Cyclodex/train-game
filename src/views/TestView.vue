<template>
  <div class="test-view">
    <div class="test-header">
      <router-link class="nav-link" to="/play">← Game</router-link>
      <div class="picker">
        <label class="picker-label" for="scenario-select">Feature</label>
        <select
          id="scenario-select"
          class="picker-select"
          :value="current.id"
          @change="onSelect"
        >
          <option v-for="s in scenarios" :key="s.id" :value="s.id">
            {{ s.name }}
          </option>
        </select>
        <p class="picker-desc">{{ current.description }}</p>
      </div>
    </div>

    <TestStage :key="current.id" :scenario="current" />
  </div>
</template>

<script lang="ts">
import { Component, Vue, toNative } from "vue-facing-decorator";
import { SCENARIOS, scenarioById, TestScenario } from "@/levels/test";
import TestStage from "@/views/TestStage.vue";

// The feature test world: a picker over the scenario registry plus the stage that
// runs the selected scenario. The active scenario comes from the `:scenario`
// route param so each map is deep-linkable (/test/signals).
@Component({ components: { TestStage } })
class TestView extends Vue {
  scenarios = SCENARIOS;

  get current(): TestScenario {
    return scenarioById(this.$route.params.scenario as string | undefined);
  }

  onSelect(e: Event) {
    const id = (e.target as HTMLSelectElement).value;
    this.$router.push(`/test/${id}`);
  }
}

export default toNative(TestView);
</script>

<style lang="scss" scoped>
.test-view {
  padding: 16px;
}
.test-header {
  display: flex;
  align-items: flex-start;
  gap: 24px;
  margin-bottom: 16px;
}
.nav-link {
  display: inline-block;
  padding: 10px 16px;
  border-radius: 8px;
  background: #2c3e50;
  color: #fff;
  text-decoration: none;

  &:hover {
    background: #34506a;
  }
}
.picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.picker-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #8fa3b3;
}
.picker-select {
  padding: 8px 12px;
  font-size: 15px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.2);
  background: #fff;
  min-width: 240px;
}
.picker-desc {
  margin: 0;
  max-width: 420px;
  color: #56657a;
  font-size: 13px;
}
</style>
