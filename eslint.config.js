import pluginVue from "eslint-plugin-vue";
import { defineConfigWithVueTs, vueTsConfigs } from "@vue/eslint-config-typescript";
import skipFormatting from "@vue/eslint-config-prettier/skip-formatting";

export default defineConfigWithVueTs(
  {
    name: "app/files-to-lint",
    files: ["**/*.{ts,mts,tsx,vue}"],
  },
  {
    name: "app/files-to-ignore",
    // `.claude/worktrees/**` is not tidiness — without it `npm run lint` is
    // UNUSABLE on any machine that has ever used a Claude Code worktree. Each one
    // is a full checkout of this repo, `dist/` bundles included, and eslint walks
    // into all of them: measured here, 2723 errors and 540 warnings from
    // eighteen stale copies against 0 errors in the repo's own sources. Nothing
    // in there is ours to lint — each worktree lints itself.
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      ".claude/worktrees/**",
    ],
  },
  pluginVue.configs["flat/essential"],
  vueTsConfigs.recommended,
  skipFormatting,
  {
    // The codebase predates the TS5 migration and leans heavily on `any` and
    // imperative cross-component access; keep these as warnings so `lint` stays
    // useful instead of drowning in legacy noise. Tighten incrementally.
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      "vue/multi-word-component-names": "off",
    },
  }
);
