<script lang="ts">
import { Component, Vue, toNative } from "vue-facing-decorator";
import { CampaignRow, CampaignLevel, campaignRows, campaignTotals } from "@/campaign";

// The level-select screen. A campaign needs this for a reason that is easy to
// miss: the win overlay's "Keep playing" dismisses itself for good, so without a
// list there is no route to the next level from a board you chose to linger on.
//
// Storage is read ONCE, in created(), into plain fields. NOT getters — a class
// getter here is a cached computed (vue-facing-decorator) reading a
// non-reactive source, so it would freeze at its first value and the screen
// would keep showing the progress you had when you opened it.
@Component
class CampaignView extends Vue {
  rows: CampaignRow[] = [];
  earned = 0;
  total = 0;

  created() {
    this.refresh();
  }

  // Re-read on focus: the player leaves for a level and comes back having won.
  activated() {
    this.refresh();
  }

  private refresh() {
    this.rows = campaignRows();
    const t = campaignTotals();
    this.earned = t.earned;
    this.total = t.total;
  }

  open(level: CampaignLevel) {
    this.$router.push({
      name: "play",
      query: { mode: level.modeId, board: level.id },
    });
  }

  pips(row: CampaignRow): boolean[] {
    return Array.from({ length: row.level.stars }, (_, i) => i < row.stars);
  }
}
export default toNative(CampaignView);
</script>

<template>
  <div class="campaign-view">
    <header class="campaign-head">
      <router-link class="campaign-back" to="/play">‹ Play</router-link>
      <h1 class="campaign-title">Campaign</h1>
      <span class="campaign-total">★ {{ earned }} / {{ total }}</span>
    </header>

    <ol class="campaign-list">
      <li v-for="row in rows" :key="row.level.id">
        <button
          v-if="row.unlocked"
          class="campaign-row"
          :class="{ 'campaign-row--cleared': row.cleared }"
          :data-level-id="row.level.id"
          @click="open(row.level)"
        >
          <span class="campaign-num">{{ row.index + 1 }}</span>
          <span class="campaign-text">
            <span class="campaign-name">{{ row.level.name }}</span>
            <span class="campaign-blurb">{{ row.level.blurb }}</span>
          </span>
          <span class="campaign-pips">
            <span
              v-for="(on, i) in pips(row)"
              :key="i"
              class="campaign-pip"
              :class="{ 'campaign-pip--on': on }"
              >★</span
            >
          </span>
        </button>
        <div
          v-else
          class="campaign-row campaign-row--locked"
          :data-level-id="row.level.id"
        >
          <span class="campaign-num">{{ row.index + 1 }}</span>
          <span class="campaign-text">
            <span class="campaign-name">{{ row.level.name }}</span>
            <span class="campaign-blurb">
              Locked — finish {{ rows[row.index - 1].level.name }} first
            </span>
          </span>
          <span class="campaign-lock">🔒</span>
        </div>
      </li>
    </ol>
  </div>
</template>

<style lang="scss" scoped>
// `glass` needs no import: vite.config.ts injects _importIntoComponents.scss
// into every component's styles.
.campaign-view {
  min-height: 100vh;
  padding: 28px 20px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
  color: #dbe3ea;
  // The same scrim the game overlays use. Without it the screen sits straight
  // on the themed backdrop, and a pale meadow behind dark glass leaves the back
  // link and every locked row barely readable.
  background: rgba(8, 11, 15, 0.62);
  backdrop-filter: blur(4px);
}

.campaign-head {
  width: 100%;
  max-width: 620px;
  display: flex;
  align-items: center;
  gap: 14px;
}

.campaign-back {
  color: #9aa7b2;
  text-decoration: none;
  font-size: 13px;
  font-weight: 600;
}
.campaign-back:hover {
  color: #dbe3ea;
}

.campaign-title {
  margin: 0;
  font-size: 22px;
  font-weight: 800;
  flex: 1;
}

.campaign-total {
  color: #f0cf72;
  font-weight: 700;
}

.campaign-list {
  list-style: none;
  margin: 0;
  padding: 0;
  width: 100%;
  max-width: 620px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.campaign-row {
  @include glass;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 12px;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

button.campaign-row:hover {
  border-color: rgba(255, 255, 255, 0.22);
}

.campaign-row--locked {
  cursor: default;
  // Dimmed, but not to the point of being unreadable: a locked row still has to
  // say which level it is and what unlocks it.
  opacity: 0.62;
}

.campaign-num {
  flex: 0 0 28px;
  height: 28px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 800;
  background: rgba(255, 255, 255, 0.08);
}

.campaign-row--cleared .campaign-num {
  background: rgba(240, 207, 114, 0.18);
  color: #f0cf72;
}

.campaign-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.campaign-name {
  font-size: 15px;
  font-weight: 700;
}

.campaign-blurb {
  font-size: 12px;
  color: #8d99a4;
}

.campaign-pips {
  display: flex;
  gap: 3px;
}

.campaign-pip {
  color: rgba(255, 255, 255, 0.2);
  font-size: 14px;
}

.campaign-pip--on {
  color: #f0cf72;
}

.campaign-lock {
  font-size: 15px;
}
</style>
