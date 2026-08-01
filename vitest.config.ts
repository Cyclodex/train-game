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
    // Hands the event loop back once per test. Read tests/unit/setup.ts before
    // removing it: without it this suite exits 1 with every test passing.
    setupFiles: ["tests/unit/setup.ts"],
  },
});
