import { createRouter, createWebHashHistory } from "vue-router";
import PlayView from "@/views/PlayView.vue";
import EditorView from "@/views/EditorView.vue";
import TestView from "@/views/TestView.vue";

// Hash history keeps `page.goto("/")` and static preview hosting working without
// any server-side SPA fallback.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/play" },
    { path: "/play", name: "play", component: PlayView },
    { path: "/editor", name: "editor", component: EditorView },
    { path: "/test/:scenario?", name: "test", component: TestView },
  ],
});
