/**
 * A small, fast, deterministic PRNG (mulberry32). Given the same seed it always
 * yields the same stream, so colour assignment is reproducible and the
 * simulation's delivery outcomes can be asserted in unit tests.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a random element using a supplied [0,1) source (seeded or `Math.random`). */
export function pickRandom<T>(list: T[], rand: () => number = Math.random): T {
  return list[Math.floor(rand() * list.length)];
}

export function getRandom(list: any[]) {
  return pickRandom(list);
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
