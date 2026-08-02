import { describe, it } from "vitest";

// TWO TIERS OF UNIT TEST, so a small change does not cost a full suite.
//
// Almost all of this suite is arithmetic on tiles, lanes and geometry and runs in
// single-digit milliseconds. A handful of cases are not: they drive the road or
// rail simulation for thousands of ticks because the behaviour they pin — a car
// park that turns over, a junction that does not gridlock, a merge that stays
// live for two simulated minutes — only EXISTS over a long run. Those are the
// suite's most valuable tests and also ~85% of its runtime.
//
// So they are tagged rather than deleted or weakened:
//
//   it(...)      the default tier. Fast. Runs in EVERY lane.
//   itSlow(...)  the long-run tier. Runs in the full suite; skipped in the fast
//                lane (`npm run test:unit:fast`).
//
// The split is by TEST, not by file, on purpose. `sim/parking.spec.ts` is the
// slowest file in the suite and also holds ~60 millisecond-fast geometry and
// registry cases; tiering by file would throw those out of the fast lane and
// leave anyone working on parking with no quick signal at all.
//
// WHEN TO TAG. Roughly: a case that takes about a second or more, which in
// practice means one that steps a sim more than a few hundred ticks. `npm run
// test:unit:profile` prints the current per-test costs — check it rather than
// guessing, and re-check it after a change to the sim's hot path, because the
// line moves. Do NOT tag a test just to get a red suite green; a slow test that
// fails in the full lane still fails.
//
// The tier is set by `vitest.fast.config.ts` through `test.env`, NOT by a shell
// `VAR=x` prefix in package.json — that form does not work on Windows, and this
// project is developed on it (see docs/KNOWHOW.md → VERIFY).
export const FAST_ONLY = process.env.VITEST_TIER === "fast";

// A long-running case: full suite only.
export const itSlow = it.skipIf(FAST_ONLY);

// A whole block of long-running cases: full suite only. For a file that is slow
// end to end (the registry-wide sweeps) rather than one with a slow case in it.
export const describeSlow = describe.skipIf(FAST_ONLY);
