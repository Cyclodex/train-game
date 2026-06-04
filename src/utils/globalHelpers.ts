export function getRandom(list: any[]) {
  return list[Math.floor(Math.random() * list.length)];
}

// Vue 2 collected every `ref` used inside a `v-for` into an array, so the game
// code looks tiles/trains up with `this.$parent.$refs[id][0]`. In Vue 3 a unique
// dynamic `:ref` inside a `v-for` registers the single instance directly. This
// helper resolves either shape to the underlying component instance.
export function resolveRef(ref: any): any {
  return Array.isArray(ref) ? ref[0] : ref;
}

export const Colors = [
  "green",
  "yellow",
  // "orange",
  "red",
  // "purple",
  "blue",
  "grey",
];
