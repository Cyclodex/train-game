import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.spec.ts"],
    // A HANG GUARD, NOT A SPEED LIMIT. Vitest's 5s default is a wall clock, and
    // a third of this suite is fixed-work simulation loops — a few thousand
    // `step(0.05)` ticks whose RESULT is deterministic (seeded rng, no clock, no
    // `Math.random` anywhere in `src/sim`) but whose RUNTIME is whatever the
    // machine has left over. On an idle box those cases run in 0.3–3.5s, so 5s
    // looked generous; measured under load it is not, and the suite then fails
    // tests that are not broken. Reproduced deliberately (64 CPU burners on 20
    // cores, ~9x): TEN cases in `sim/parking.spec.ts` went red and every single
    // failure was "Test timed out" — not one assertion. Two of them are exactly
    // the pair that was reported as a red master.
    //
    // 30s, so a case's verdict comes from its assertions and not from what else
    // the machine is doing — a parallel `npm run test:unit`, a dev server, a
    // second agent session. It stays under vitest's hardcoded 60s worker-RPC
    // timeout (see tests/unit/setup.ts), so a genuinely stuck test still reports
    // as itself rather than poisoning the run with `Timeout calling
    // "onTaskUpdate"`. The handful of cases that legitimately need longer say so
    // per test (60_000 / 120_000 in sim/parking.spec.ts).
    //
    // If a case ever needs MORE than this, make it cheaper before you raise it:
    // split it per map/seed the way the long-run parking cases are (see the
    // comment above them). A budget is not a tolerance — never buy a green here
    // that an assertion should have earned.
    testTimeout: 30_000,
    // Hands the event loop back once per test. Read tests/unit/setup.ts before
    // removing it: without it this suite exits 1 with every test passing.
    setupFiles: ["tests/unit/setup.ts"],
  },
});
