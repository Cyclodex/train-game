import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
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
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
