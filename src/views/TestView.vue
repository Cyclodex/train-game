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

    <!-- Levels 1–3: a grid of image tiles drilling down the taxonomy. Each tile
         shows a sim-free preview of a representative level as its background. -->
    <div v-else class="card-grid">
      <!-- Level 1: domains -->
      <template v-if="!domain">
        <router-link
          v-for="d in domains"
          :key="d.id"
          class="card"
          :to="`/test/${d.id}`"
        >
          <span class="card-thumb"><ScenarioThumb :scenario="rep(d)" /></span>
          <span class="card-veil"></span>
          <span class="card-icon">{{ iconDomain(d.id) }}</span>
          <span class="card-overlay">
            <span class="card-title">{{ d.label }}</span>
            <span class="card-meta">{{ countLabel(countDomain(d)) }}</span>
          </span>
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
          <span class="card-thumb"><ScenarioThumb :scenario="rep(c)" /></span>
          <span class="card-veil"></span>
          <span class="card-icon">{{ iconCategory(domain.id, c.id) }}</span>
          <span class="card-overlay">
            <span class="card-title">{{ c.label }}</span>
            <span class="card-meta">{{ countLabel(c.scenarios.length) }}</span>
          </span>
        </router-link>
      </template>

      <!-- Level 3: scenarios within a category -->
      <template v-else>
        <router-link
          v-for="s in category.scenarios"
          :key="s.id"
          class="card"
          :to="`/test/${domain.id}/${category.id}/${s.id}`"
        >
          <span class="card-thumb"><ScenarioThumb :scenario="s" /></span>
          <span class="card-veil"></span>
          <span class="card-icon card-icon--scenario">{{ iconScenario(s.id) }}</span>
          <span class="card-overlay">
            <span class="card-title">{{ s.name }}</span>
            <span class="card-desc">{{ s.description }}</span>
          </span>
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
  firstScenarioOf,
  locate,
} from "@/levels/test";
import { iconForDomain, iconForCategory, iconForScenario } from "@/levels/test/icons";
import TestStage from "@/views/TestStage.vue";
import ScenarioThumb from "@/components/ScenarioThumb.vue";

// The feature test world: a drill-down gallery over the scenario taxonomy
// (domain → category → scenario). The active level is read from the route params
// so every level is deep-linkable (/test, /test/streets, /test/streets/lanes,
// /test/streets/lanes/roadlanemerge). An invalid param simply falls back to the
// nearest valid level (treated as absent).
@Component({ components: { TestStage, ScenarioThumb } })
class TestView extends Vue {
  domains: ScenarioDomain[] = DOMAINS;

  // The representative scenario whose map previews a domain or category tile.
  rep(node: ScenarioDomain | ScenarioCategory): TestScenario {
    return firstScenarioOf(node);
  }

  // Big identity glyph for each tile (over the dimmed level preview).
  iconDomain = iconForDomain;
  iconCategory = iconForCategory;
  iconScenario = iconForScenario;

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

  // "1 scenario" / "N scenarios" — pluralised count label for a domain/category tile.
  countLabel(n: number): string {
    return `${n} scenario${n === 1 ? "" : "s"}`;
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
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
  max-width: 1200px;
}
// A BeamNG-style image tile: full-bleed level preview, dark gradient, title over
// it. The whole tile is a link; hovering zooms the art and lifts the card.
.card {
  position: relative;
  display: block;
  aspect-ratio: 16 / 10;
  border-radius: 12px;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  background: #2a3340;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
  &:hover {
    transform: translateY(-3px);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.4);
  }
}
.card-thumb {
  position: absolute;
  inset: 0;
  transition: transform 0.2s ease;
  .card:hover & {
    transform: scale(1.06);
  }
}
// A soft dark veil over the preview so the big glyph reads on any map. Darkest in
// the centre (behind the icon), clearing toward the edges so the map still shows.
.card-veil {
  position: absolute;
  inset: 0;
  background: radial-gradient(
    ellipse at 50% 42%,
    rgba(8, 12, 16, 0.62) 0%,
    rgba(8, 12, 16, 0.34) 45%,
    rgba(8, 12, 16, 0.1) 75%
  );
}
// The identity glyph — large, centred a little above middle, lifting on hover.
.card-icon {
  position: absolute;
  top: 42%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 58px;
  line-height: 1;
  filter: drop-shadow(0 3px 6px rgba(0, 0, 0, 0.55));
  transition: transform 0.15s ease;
  pointer-events: none;
  .card:hover & {
    transform: translate(-50%, -50%) scale(1.12);
  }
}
.card-icon--scenario {
  font-size: 46px;
}
.card-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 3px;
  padding: 12px 14px;
  // Darken the bottom so the title reads over any map; fade to clear up top.
  background: linear-gradient(
    to top,
    rgba(8, 12, 16, 0.92) 0%,
    rgba(8, 12, 16, 0.7) 26%,
    rgba(8, 12, 16, 0.12) 55%,
    rgba(8, 12, 16, 0) 80%
  );
}
.card-title {
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.card-meta {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #b9c6d2;
}
.card-desc {
  font-size: 12.5px;
  line-height: 1.35;
  color: #d4dde4;
  // Keep long descriptions from overgrowing the tile.
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.stage-desc {
  margin: 0 0 12px;
  max-width: 640px;
  color: #cfd8e0;
  font-size: 14px;
}
</style>
