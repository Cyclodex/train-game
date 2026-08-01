<template>
  <aside v-if="stats.enabled" class="city-panel">
    <header class="city-panel__head">
      <span class="city-panel__clock">{{ stats.clock }}</span>
      <span class="city-panel__day">Day {{ stats.day + 1 }}</span>
      <span class="city-panel__pop" title="People living on this board">
        👥 {{ stats.population }}
      </span>
      <span class="city-panel__moving" title="Travelling right now">
        ➜ {{ stats.travelling }}
      </span>
    </header>

    <!-- The sentence the player is trying to change: how this board gets about. -->
    <div class="city-panel__share" title="How completed journeys were made">
      <span
        v-for="m in modeRows"
        :key="m.key"
        class="city-panel__share-seg"
        :class="`is-${m.key}`"
        :style="{ flexGrow: m.value }"
        :title="`${m.label}: ${Math.round(m.value * 100)}%`"
      />
    </div>
    <div class="city-panel__legend">
      <span v-for="m in modeRows" :key="m.key" class="city-panel__legend-item">
        <i :class="`dot is-${m.key}`" />{{ m.label }} {{ Math.round(m.value * 100) }}%
      </span>
    </div>

    <ul class="city-panel__list">
      <li v-for="city in cities" :key="city.id" class="city">
        <div class="city__row">
          <span class="city__name">{{ city.name }}</span>
          <span class="city__pop">
            {{ city.population }}
            <i class="city__trend" :class="trendOf(city)">{{ trendGlyph(city) }}</i>
          </span>
        </div>
        <div class="city__row city__row--sub">
          <span>{{ city.jobs.filled }}/{{ city.jobs.total }} jobs</span>
          <span v-if="city.wantsRoom" class="city__wants" title="Full, and still growing — paint more urban ground">
            needs room
          </span>
        </div>
        <div v-for="bar in barsOf(city)" :key="bar.key" class="city__bar" :title="bar.title">
          <span class="city__bar-label">{{ bar.label }}</span>
          <span class="city__bar-track">
            <span
              class="city__bar-fill"
              :class="moodClass(bar.value)"
              :style="{ width: Math.round(bar.value * 100) + '%' }"
            />
          </span>
        </div>
      </li>
    </ul>
  </aside>
</template>

<script lang="ts">
import { Component, Inject, Vue, toNative } from "vue-facing-decorator";
import type { Game, CitizenHud } from "@/game";
import type { CityState } from "@/sim/citizens";

// The city cards: the whole readout of the Citizens mode, and deliberately the
// ONLY one. A citizen layer can generate an unbounded amount of chrome, and the
// Train Valley post-mortem (design doc §5) is specifically a warning about
// that — so this shows the four numbers a player can act on and nothing else:
// who lives here, whether they have work, how they get about, and how they feel
// about the three things the network decides.
@Component
class CityPanel extends Vue {
  @Inject() game!: Game;

  get stats(): CitizenHud {
    return this.game.citizenStats;
  }

  get cities(): CityState[] {
    return this.game.cities;
  }

  get modeRows() {
    const s = this.stats.modeShare;
    return [
      { key: "walk", label: "Walk", value: s.walk },
      { key: "car", label: "Car", value: s.car },
      { key: "transit", label: "Train", value: s.transit },
      { key: "parkAndRide", label: "P+R", value: s.parkAndRide },
    ].filter(m => m.value > 0);
  }

  barsOf(city: CityState) {
    return [
      {
        key: "commute",
        label: "Commute",
        value: city.happiness.commute,
        title: "How getting to work is going",
      },
      {
        key: "errands",
        label: "Errands",
        value: city.happiness.errands,
        title: "How getting to the shops is going",
      },
      {
        key: "access",
        label: "Access",
        value: city.happiness.access,
        title: "Whether the journey can be made at all",
      },
    ];
  }

  moodClass(v: number): string {
    return v >= 0.6 ? "is-good" : v >= 0.4 ? "is-ok" : "is-bad";
  }

  trendOf(city: CityState): string {
    if (city.population > city.populationYesterday) return "is-up";
    if (city.population < city.populationYesterday) return "is-down";
    return "is-flat";
  }

  trendGlyph(city: CityState): string {
    const t = this.trendOf(city);
    return t === "is-up" ? "▲" : t === "is-down" ? "▼" : "–";
  }
}

export default toNative(CityPanel);
</script>

<style lang="scss" scoped>
.city-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 30;
  width: 230px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(18, 22, 28, 0.72);
  backdrop-filter: blur(8px);
  color: #eef2f6;
  font-size: 12px;
  line-height: 1.35;
  box-shadow: 0 6px 22px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.city-panel__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}
.city-panel__clock {
  font-size: 16px;
  font-weight: 600;
}
.city-panel__day {
  opacity: 0.6;
}
.city-panel__pop {
  margin-left: auto;
  font-weight: 600;
}
.city-panel__moving {
  opacity: 0.7;
}

.city-panel__share {
  display: flex;
  height: 6px;
  margin: 8px 0 4px;
  border-radius: 3px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.12);
}
.city-panel__share-seg {
  min-width: 2px;
}
.city-panel__legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  font-size: 10px;
  opacity: 0.75;
}
.city-panel__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}
// One colour per mode, shared by the bar and its legend dot.
.is-walk {
  background: #7fd4a4;
}
.is-car {
  background: #f2b45c;
}
.is-transit {
  background: #6cb6ff;
}
.is-parkAndRide {
  background: #c79bf2;
}

.city-panel__list {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: grid;
  gap: 10px;
}
.city {
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.12);
}
.city__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px;
}
.city__row--sub {
  font-size: 10px;
  opacity: 0.65;
  margin-bottom: 4px;
}
.city__name {
  font-weight: 600;
}
.city__pop {
  font-variant-numeric: tabular-nums;
}
.city__trend {
  font-style: normal;
  font-size: 9px;
  &.is-up {
    color: #7fd4a4;
  }
  &.is-down {
    color: #f28b82;
  }
  &.is-flat {
    opacity: 0.4;
  }
}
.city__wants {
  color: #ffd27f;
}

.city__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}
.city__bar-label {
  width: 52px;
  font-size: 10px;
  opacity: 0.7;
}
.city__bar-track {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.city__bar-fill {
  display: block;
  height: 100%;
  transition: width 0.4s ease;
  &.is-good {
    background: #7fd4a4;
  }
  &.is-ok {
    background: #f2d05c;
  }
  &.is-bad {
    background: #f28b82;
  }
}
</style>
