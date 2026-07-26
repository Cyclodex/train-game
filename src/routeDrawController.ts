import { reactive } from "vue";
import type { Port } from "@/tiles/model";
import { planRoute, OpenEnd, RouteOpts, RouteStep } from "@/tiles/routePlanner";
import { oppositePort } from "@/sim/topology";

// The route-drawing gesture, extracted headless from EditorView so PlayView can
// reuse it for building track during play instead of growing a divergent copy.
// Same shape as cameraController.ts (the house pattern): a create function that
// owns its own reactive() state, built by the view in `created()` (NOT a field
// initialiser — vue-facing-decorator collects data off a throwaway instance) and
// stored with markRaw.
//
// The gesture is three interlocking flows over the tiles' triangular edge
// hit-zones, all planning through `planRoute` (Dijkstra, turn-minimised):
//
// - ONE-SHOT DRAG: press an edge (`pressFrom`), release on another zone — one
//   route is laid, anchor tile included. The browser only fires `click` when
//   down and up share an element, so a drag never also triggers the chaining.
// - CLICK CHAINING (route mode): click an edge to arm the route head (`armed`),
//   then each click extends the route corner by corner and advances the head.
//   Clicking the edge the track entered through is the U-TURN case: the
//   frontier tile is left undecided (`pendingId`), the head trails one tile
//   back, and the next click (or finishing) decides its shape.
// - HOVER GHOST: `hoverPort` + `previewSteps()` describe the route the next
//   release/click would lay, for the caller to draw as a ghost.
//
// The controller is layer-agnostic and DOM-free: the caller passes it ports
// from its own event wiring, says which layer is being drawn (`drawing()` —
// null disables every handler), supplies live plan options, and receives the
// connections to lay as `RouteStep[]` (anchor/terminus straights included, in
// lay order). The editor lays cell by cell into its level; play lays atomically
// via `game.applyEdits`. How a step is painted (rail vs road, ghost style) is
// the caller's business — a step is just "cell id, entry edge, exit edge".
export interface RouteDrawConfig {
  // The layer the caller is currently drawing on, or null when its active tool
  // is not a drawing tool at all (which disables the whole gesture).
  drawing(): "rail" | "road" | null;
  // Live route-planning options: grid size + the terrain `passable` gate.
  planOpts(): RouteOpts;
  // Lay these connections, in order. Steps travel a -> b (one-way roads care).
  lay(steps: RouteStep[]): void;
}

export interface RouteDrawController {
  readonly state: {
    pressFrom: { id: string; port: Port } | null;
    armed: { id: string; port: Port } | null;
    routeStarted: boolean;
    pendingId: string | null;
    hoverPort: { id: string; port: Port } | null;
  };
  // The tile to glow: the pending frontier tile (U-turn case) while routing,
  // otherwise the head tile, else null.
  readonly glowId: string | null;
  // The armed START edge (wedge cue) — only before the route's first segment.
  isArmed(id: string, port: Port): boolean;
  // The open-end edge that finishes the route when clicked again.
  isFinish(id: string, port: Port): boolean;
  // The connections the next release/click would lay, for the ghost preview.
  previewSteps(): RouteStep[];
  onZoneDown(id: string, port: Port): void;
  onZoneUp(id: string, port: Port): void;
  onZoneClick(id: string, port: Port): void;
  onZoneEnter(id: string, port: Port): void;
  onZoneLeave(id: string, port: Port): void;
  // Abandon an in-progress press (mouse released off the zones / left the grid).
  clearPress(): void;
  // Forget press + hover and finish any open route — the caller's tool changed.
  toolChanged(): void;
  // Forget the press and the route head WITHOUT finishing: the world was
  // re-based under the gesture (grow left/up), so every tile id went stale.
  dropAnchors(): void;
  // Finish route mode: lock a pending frontier tile as a straight terminus and
  // clear the head (Esc, clicking the head edge again, or a tool change).
  finishRoute(): void;
}

export function createRouteDrawController(
  cfg: RouteDrawConfig
): RouteDrawController {
  const state = reactive({
    pressFrom: null,
    armed: null,
    routeStarted: false,
    pendingId: null,
    hoverPort: null,
  }) as RouteDrawController["state"];

  // A straight through `end`'s tile, exiting the tile through `end.edge`. Used
  // for the route's anchor tile and for locking a pending frontier tile.
  const straightOut = (end: OpenEnd): RouteStep => ({
    id: end.id,
    a: oppositePort(end.edge),
    b: end.edge,
  });

  // Lay the whole route from `from` to `to` in one go (the drag gesture). The
  // anchor tile is laid as a straight in its pressed direction. Returns the
  // route's new open end, or null if no route fits.
  function commitSegment(
    from: OpenEnd,
    to: OpenEnd,
    layAnchor: boolean
  ): OpenEnd | null {
    const steps = planRoute(from, to, cfg.planOpts());
    if (!steps || steps.length === 0) return null;
    const toLay: RouteStep[] = [];
    if (layAnchor && from.id !== to.id) toLay.push(straightOut(from));
    toLay.push(...steps);
    cfg.lay(toLay);
    const last = steps[steps.length - 1];
    return { id: last.id, edge: last.b };
  }

  // Plan the route to the clicked tile and lay it. The last tile is drawn
  // `incoming -> clicked edge` for any of its three exit edges; only if you
  // click the edge the track enters through (a U-turn) is it left blank and
  // the head trails one tile back so your next click decides its shape.
  function extendRoute(targetId: string, targetPort: Port) {
    const head = state.armed!;
    const steps = planRoute(
      { id: head.id, edge: head.port },
      { id: targetId, edge: targetPort },
      cfg.planOpts()
    );
    if (!steps || steps.length === 0) return;
    const toLay: RouteStep[] = [];
    // The first segment of a fresh route also lays the head tile as a straight
    // in its clicked direction.
    if (!state.routeStarted && head.id !== targetId) {
      toLay.push(straightOut({ id: head.id, edge: head.port }));
    }
    state.routeStarted = true;
    const last = steps[steps.length - 1];
    const uTurn = targetPort === last.a; // pointing at the incoming edge
    const count = uTurn ? steps.length - 1 : steps.length;
    for (let i = 0; i < count; i++) toLay.push(steps[i]);
    cfg.lay(toLay);
    if (uTurn) {
      const penultId =
        steps.length >= 2 ? steps[steps.length - 2].id : head.id;
      state.armed = { id: penultId, port: oppositePort(last.a) };
      state.pendingId = last.id; // frontier tile stays undecided
    } else {
      state.armed = { id: last.id, port: last.b }; // exit = the clicked edge
      state.pendingId = null;
    }
  }

  function finishRoute() {
    if (state.pendingId && state.armed) {
      // Lock the still-undecided frontier tile as a plain straight terminus.
      cfg.lay([straightOut({ id: state.pendingId, edge: state.armed.port })]);
    }
    state.armed = null;
    state.routeStarted = false;
    state.pendingId = null;
  }

  return {
    state,
    get glowId(): string | null {
      return state.pendingId ?? state.armed?.id ?? null;
    },
    isArmed(id: string, port: Port): boolean {
      // Only the start edge shows the armed wedge; once routing the glow
      // follows the pending frontier tile instead.
      return (
        !state.routeStarted &&
        state.armed?.id === id &&
        state.armed?.port === port
      );
    },
    isFinish(id: string, port: Port): boolean {
      return (
        state.routeStarted &&
        state.armed?.id === id &&
        state.armed?.port === port
      );
    },
    // The route the pointer is currently describing, as the steps that would be
    // laid. Anchors on the in-progress drag start if there is one, otherwise
    // the route head — so the preview spans every tile for both gestures.
    previewSteps(): RouteStep[] {
      if (!cfg.drawing()) return [];
      const from = state.pressFrom ?? state.armed;
      const to = state.hoverPort;
      if (!from || !to) return [];
      const steps = planRoute(
        { id: from.id, edge: from.port },
        { id: to.id, edge: to.port },
        cfg.planOpts()
      );
      if (!steps || steps.length === 0) return [];
      const out: RouteStep[] = [];
      // The start tile is laid as a straight only for the first segment of a
      // fresh route (a drag is always a one-shot first segment).
      if ((state.pressFrom || !state.routeStarted) && from.id !== to.id) {
        out.push(straightOut({ id: from.id, edge: from.port }));
      }
      // The pointed-at tile draws `incoming -> hovered edge` for its three exit
      // edges; it's left blank only when you point at the edge the track enters
      // through (a U-turn). A one-shot drag always draws its whole route.
      const last = steps[steps.length - 1];
      const uTurn = !state.pressFrom && to.port === last.a;
      const count = uTurn ? steps.length - 1 : steps.length;
      for (let i = 0; i < count; i++) out.push(steps[i]);
      return out;
    },
    // A drag starts here; if it ends on a DIFFERENT zone (onZoneUp) it lays one
    // route. The browser only fires `click` when down and up share an element,
    // so a drag never also triggers the click-chaining below.
    onZoneDown(id: string, port: Port) {
      if (!cfg.drawing()) return;
      state.pressFrom = { id, port };
    },
    onZoneUp(id: string, port: Port) {
      if (!cfg.drawing()) return;
      const from = state.pressFrom;
      state.pressFrom = null;
      if (from && (from.id !== id || from.port !== port)) {
        commitSegment(
          { id: from.id, edge: from.port },
          { id, edge: port },
          true
        );
      }
    },
    onZoneClick(id: string, port: Port) {
      if (!cfg.drawing()) return;
      const head = state.armed;
      if (!head) {
        state.armed = { id, port }; // start a route at this open end
        state.routeStarted = false;
        return;
      }
      // Finish: click the start edge again, or click the pending frontier tile.
      if ((head.id === id && head.port === port) || state.pendingId === id) {
        finishRoute();
        return;
      }
      extendRoute(id, port);
    },
    onZoneEnter(id: string, port: Port) {
      if (cfg.drawing()) state.hoverPort = { id, port };
    },
    onZoneLeave(id: string, port: Port) {
      if (state.hoverPort?.id === id && state.hoverPort?.port === port) {
        state.hoverPort = null;
      }
    },
    clearPress() {
      state.pressFrom = null;
    },
    toolChanged() {
      state.pressFrom = null;
      state.hoverPort = null;
      finishRoute();
    },
    dropAnchors() {
      state.armed = null;
      state.pressFrom = null;
    },
    finishRoute,
  };
}
