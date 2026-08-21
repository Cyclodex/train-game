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
      <p class="stage-desc">
        <span class="stage-desc-icon" aria-hidden="true">ℹ️</span>
        <span class="stage-desc-text">{{ scenario.description }}</span>
      </p>
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
// THE PAGE IS EXACTLY ONE SCREEN AND NEVER SCROLLS.
//
// It used to be a plain block with 16px of padding, and the stage inside it was
// 100vh tall — so the page was always ~160px taller than the window (padding +
// breadcrumb + description) and every one of the stage's own controls sat below
// the fold. Hunting for the Pause button by scrolling is not a viewport.
//
// So: a flex column pinned to the viewport height. The chrome takes what it
// needs, the stage takes the rest, and whatever wants to scroll (the card grid)
// scrolls INSIDE itself. The board no longer needs page padding to breathe —
// that is the camera's job now, as a margin you can push the world away from
// (`WORLD_MARGIN` in camera.ts).
.test-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
.test-header {
  @include glass;
  display: inline-flex;
  align-self: flex-start;
  flex: 0 0 auto;
  align-items: center;
  gap: 16px;
  margin: 10px 0 8px 12px;
  padding: 10px 14px;
}
.nav-link {
  @include glass-button;
  padding: 9px 14px;
  text-decoration: none;
}
.crumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  row-gap: 2px;
  min-width: 0;
  font-size: 14px;
}
// A crumb wraps as a WHOLE label or not at all. Without this a narrow header
// tore "One-way & lanes" into four stacked lines of one word each.
.crumb {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
// The picker is the one part that can outgrow a screen, so IT scrolls — not the
// page. Its own padding replaces the page padding that used to surround it.
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  // `grid-auto-rows: max-content` IS LOAD-BEARING, not tidiness. The row track
  // has to be sized from the card's transferred aspect-ratio height. Left at
  // `auto`, a card whose children are ALL absolutely positioned contributes no
  // content height, and once the rows stop fitting the (definite, scrolling)
  // grid height Chrome collapses every track to a slice of the leftover space —
  // measured 45px tracks under 214px cards. The cards then OVERLAP: on a phone
  // the gallery was a stack of stripes with every title and description buried
  // under the next card. It only bit narrow screens because a wide one fits its
  // three rows in the viewport and never reaches the squeeze.
  grid-auto-rows: max-content;
  gap: 16px;
  flex: 1 1 auto;
  min-height: 0;
  align-content: start;
  overflow-y: auto;
  padding: 4px 16px 16px;
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
  // Scenario prose carries paths like `/test/lanedrop` — no space to break at,
  // so without this the card scrolls sideways instead of wrapping.
  overflow-wrap: anywhere;
  // Keep long descriptions from overgrowing the tile.
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
// The scenario's purpose, shown as a glass panel between the breadcrumb and the
// stage so it reads on any map backdrop.
.stage-desc {
  @include glass(8px, 12px);
  display: flex;
  width: fit-content;
  align-items: baseline;
  flex: 0 0 auto;
  gap: 10px;
  margin: 0 auto 8px;
  padding: 8px 16px;
  max-width: 720px;
  color: #cfd8e0;
  font-size: 13.5px;
  line-height: 1.5;
  text-align: left;
}
.stage-desc-icon {
  flex: 0 0 auto;
  font-size: 14px;
}

// ---- Phone / short-screen layout -------------------------------------------
//
// The same `(max-width: 700px), (max-height: 500px)` pair the rest of the HUD
// uses (see `_hud.scss`, BuildDock, EditorView) so the whole app changes shape
// at one breakpoint — and so a LANDSCAPE phone, which is wide but only ~375px
// tall, gets the compact treatment too.
//
// The gallery's desktop proportions do not survive either shape: a 16/10 tile on
// the full 343px column is 214px tall, so barely two fit on a portrait screen and
// drilling through 81 scenarios is all scrolling. The tile therefore goes
// BANNER-shaped — wide and short — which keeps the title and the two-line
// description at full column width (the readable part) and spends less height on
// the map art. The glyph and the paddings shrink with it so the text still clears
// the icon.
@media (max-width: 700px), (max-height: 500px) {
  .test-header {
    align-self: stretch;
    gap: 10px;
    margin: 8px 8px 6px;
    padding: 8px 10px;
  }
  .nav-link {
    flex: 0 0 auto;
    padding: 8px 11px;
    font-size: 13px;
  }
  .crumbs {
    font-size: 12.5px;
  }
  .card-grid {
    gap: 10px;
    padding: 2px 10px 12px;
  }
  .card {
    aspect-ratio: 16 / 7;
    border-radius: 10px;
  }
  .card-icon {
    top: 36%;
    font-size: 40px;
  }
  .card-icon--scenario {
    font-size: 32px;
  }
  .card-overlay {
    gap: 2px;
    padding: 8px 11px;
  }
  .card-title {
    font-size: 15px;
  }
  .card-meta {
    font-size: 10.5px;
  }
  .card-desc {
    font-size: 12px;
  }
  // The description is prose and some scenarios write a paragraph of it: left at
  // its desktop size it took HALF a phone screen and pushed the board off the
  // bottom. Cap it at a quarter of the screen and let the long ones scroll
  // inside the panel — nothing is hidden, and the stage keeps its room.
  .stage-desc {
    margin: 0 8px 6px;
    padding: 7px 10px;
    max-height: 24vh;
    overflow-y: auto;
    gap: 8px;
    font-size: 12.5px;
    line-height: 1.45;
  }
}
</style>
