import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vitejs.dev/config/
// Honour PORT when the environment assigns one (Claude Code's preview launcher,
// CI, containers) and fall back to Vite's own default otherwise. Without this,
// Vite ignores PORT entirely and quietly drifts to the next free port when 5173
// is taken — which looks like a working server on a port nothing is watching.
// `strictPort` only when a port was assigned: bind exactly what we were told to,
// or fail loudly instead of drifting.
const assignedPort = Number(process.env.PORT) || undefined;

export default defineConfig({
  // Relative asset paths so the same build works at any URL depth — the GitHub
  // Pages project root (/train-game/) and PR previews (/train-game/pr-preview/
  // pr-N/) alike. Safe here because the router uses hash history, so the page
  // itself is always index.html.
  base: "./",
  plugins: [vue()],
  server: {
    port: assignedPort,
    strictPort: assignedPort !== undefined,
    headers: {
      // Allow the JS Self-Profiling API (`new Profiler(...)`) in dev, so the
      // perf harness can take real CPU profiles of the frame loop in a page
      // context (see docs/PERFORMANCE.md). Chrome refuses the API without this
      // Document-Policy header; it has no effect on anything else.
      "Document-Policy": "js-profiling",
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        // Make colour + variable definitions available in every component's
        // <style lang="scss"> block (replaces vue-cli's css.loaderOptions.prependData).
        additionalData: `@import "@/scss/_importIntoComponents.scss";`,
        // The stylesheets still use `@import`; silence Dart Sass's deprecation
        // notice until they are migrated to the `@use` module system.
        silenceDeprecations: ["import"],
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
