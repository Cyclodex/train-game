<template>
  <div class="test-view">
    <div class="test-header">
      <router-link class="nav-link" to="/play">← Game</router-link>
      <nav class="crumbs" aria-label="Breadcrumb">
        <router-link class="crumb" to="/test">Test</router-link>
        <template v-if="domain">
          <span class="crumb-sep">/</span>
          <router-link class="crumb" :to="`/test/${domain.id}`">{{ domain.label }}</router-link>
        </template>
        <template v-if="domain && category">
          <span class="crumb-sep">/</span>
          <router-link class="crumb" :to="`/test/${domain.id}/${category.id}`">
            {{ category.label }}
          </router-link>
        </template>
        <template v-if="scenario">
          <span class="crumb-sep">/</span>
          <span class="crumb crumb-current">{{ scenario.name }}</span>
        </template>
      </nav>
    </div>

    <!-- Level 4: a scenario is selected → show its live stage. -->
    <template v-if="scenario">
      <p class="stage-desc">{{ scenario.description }}</p>
      <TestStage :key="scenario.id" :scenario="scenario" />
    </template>

    <!-- Levels 1–3: a grid of cards drilling down the taxonomy. -->
    <div v-else class="card-grid">
      <!-- Level 1: domains -->
      <template v-if="!domain">
        <router-link
          v-for="d in domains"
          :key="d.id"
          class="card"
          :to="`/test/${d.id}`"
        >
          <span class="card-title">{{ d.label }}</span>
          <span class="card-meta">{{ countDomain(d) }} scenarios</span>
        </router-link>
      </template>

      <!-- Level 2: categories within a domain -->
      <template v-else-if="!category">
        <router-link
          v-for="c in domain.categories"
          :key="c.id"
          class="card"
          :to="`/test/${domain.id}/${c.id}`"
        >
          <span class="card-title">{{ c.label }}</span>
          <span class="card-meta">{{ c.scenarios.length }} scenarios</span>
        </router-link>
      </template>

      <!-- Level 3: scenarios within a category -->
      <template v-else>
        <router-link
          v-for="s in category.scenarios"
          :key="s.id"
          class="card card-scenario"
          :to="`/test/${domain.id}/${category.id}/${s.id}`"
        >
          <span class="card-title">{{ s.name }}</span>
          <span class="card-desc">{{ s.description }}</span>
        </router-link>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { Component, Vue, Watch, toNative } from "vue-facing-decorator";
import {
  DOMAINS,
  ScenarioCategory,
  ScenarioDomain,
  TestScenario,
  domainById,
  locate,
} from "@/levels/test";
import TestStage from "@/views/TestStage.vue";

// The feature test world: a drill-down gallery over the scenario taxonomy
// (domain → category → scenario). The active level is read from the route params
// so every level is deep-linkable (/test, /test/streets, /test/streets/lanes,
// /test/streets/lanes/roadlanemerge). An invalid param simply falls back to the
// nearest valid level (treated as absent).
@Component({ components: { TestStage } })
class TestView extends Vue {
  domains: ScenarioDomain[] = DOMAINS;

  get domain(): ScenarioDomain | undefined {
    return domainById(this.$route.params.domain as string | undefined);
  }

  get category(): ScenarioCategory | undefined {
    const id = this.$route.params.category as string | undefined;
    return this.domain?.categories.find(c => c.id === id);
  }

  get scenario(): TestScenario | undefined {
    const id = this.$route.params.scenario as string | undefined;
    return this.category?.scenarios.find(s => s.id === id);
  }

  countDomain(d: ScenarioDomain): number {
    return d.categories.reduce((n, c) => n + c.scenarios.length, 0);
  }

  // Back-compat: old deep links were a bare `/test/:scenarioId` (e.g.
  // /test/signals). Domain ids never collide with scenario ids, so a lone first
  // segment that isn't a domain but is a known scenario id is rewritten to its
  // full gallery path. A route-record `beforeEnter` can't do this — it doesn't
  // fire on in-app param-only changes — so the component owns it, immediately on
  // mount and on every route change.
  @Watch("$route", { immediate: true })
  redirectLegacyDeepLink() {
    const { domain, category, scenario } = this.$route.params;
    if (domain && !category && !scenario && !domainById(domain as string)) {
      const found = locate(domain as string);
      if (found) {
        this.$router.replace(`/test/${found.domain.id}/${found.category.id}/${domain}`);
      }
    }
  }
}

export default toNative(TestView);
</script>

<style lang="scss" scoped>
.test-view {
  padding: 16px;
}
.test-header {
  @include glass;
  display: inline-flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
  padding: 12px 16px;
}
.nav-link {
  @include glass-button;
  padding: 9px 14px;
  text-decoration: none;
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.crumb {
  color: #8fa3b3;
  text-decoration: none;
  &:hover {
    color: #cfd8e0;
  }
}
.crumb-current {
  color: #fff;
  font-weight: 600;
}
.crumb-sep {
  color: #5a6b78;
}
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 14px;
  max-width: 1100px;
}
.card {
  @include glass;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px;
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  transition: transform 0.08s ease, box-shadow 0.08s ease;
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  }
}
.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
}
.card-meta {
  font-size: 12px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8fa3b3;
}
.card-desc {
  font-size: 13px;
  line-height: 1.4;
  color: #cfd8e0;
}
.card-scenario {
  min-height: 88px;
}
.stage-desc {
  margin: 0 0 12px;
  max-width: 640px;
  color: #cfd8e0;
  font-size: 14px;
}
</style>
