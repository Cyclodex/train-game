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
  plugins: [vue()],
  server: {
    port: assignedPort,
    strictPort: assignedPort !== undefined,
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
