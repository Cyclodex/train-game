<template>
  <div class="tile"></div>
</template>

<script lang="ts">
import { Component, Vue } from "vue-property-decorator";

@Component
export default class Tile extends Vue {}
</script>

<style scoped>
.tile {
  background-color: lightgreen;
  width: 100%;
  height: 100%;
}
</style>
