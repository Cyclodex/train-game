import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

// THE FAST LANE — the whole suite minus the long-running simulation cases.
// `npm run test:unit:fast`. See tests/unit/support/tier.ts for what gets tagged
// and why, and docs/KNOWHOW.md → VERIFY for which lane to run when.
//
// The tier is passed as an ENV VAR SET BY THE CONFIG, not as a `VITEST_TIER=fast
// vitest run` prefix in package.json: that shell form is not portable to Windows,
// which this project is developed on. `test.env` populates `process.env` inside
// the worker on every platform.
//
// Note this SKIPS the slow cases rather than excluding their files, so a fast run
// still reports them — "29 skipped" is the reminder that a full run is still
// owed before pushing.
export default mergeConfig(
  base,
  defineConfig({
    test: {
      env: { VITEST_TIER: "fast" },
    },
  }),
);
