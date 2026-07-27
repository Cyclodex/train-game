import { createRouter, createWebHashHistory } from "vue-router";
import PlayView from "@/views/PlayView.vue";
import EditorView from "@/views/EditorView.vue";
import TestView from "@/views/TestView.vue";
import CampaignView from "@/views/CampaignView.vue";

// Hash history keeps `page.goto("/")` and static preview hosting working without
// any server-side SPA fallback.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/play" },
    { path: "/play", name: "play", component: PlayView },
    { path: "/editor", name: "editor", component: EditorView },
    // The campaign: an ordered level list with an unlock chain. A SCREEN, not a
    // mode — a GameMode is a ruleset with a setup() to run, and a campaign is an
    // index over boards, so putting it in MODES would misuse that contract.
    { path: "/campaign", name: "campaign", component: CampaignView },
    // The feature test world is a drill-down gallery: /test → domains,
    // /test/:domain → categories, /test/:domain/:category → scenarios,
    // /test/:domain/:category/:scenario → the live stage. TestView renders the
    // level matching whichever params are present, and redirects bare
    // `/test/:scenarioId` back-compat links to their full path.
    { path: "/test/:domain?/:category?/:scenario?", name: "test", component: TestView },
  ],
});
