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
    ignores: ["dist/**", "node_modules/**", "coverage/**", "playwright-report/**"],
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
      "@typescript-eslint/no-unused-vars": "warn",
      "vue/multi-word-component-names": "off",
    },
  }
);
