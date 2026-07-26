import { describe, it, expect } from "vitest";
import { Position } from "@/types";
import type { RouteStep } from "@/tiles/routePlanner";
import {
  createRouteDrawController,
  RouteDrawController,
} from "@/routeDrawController";

const { Top, Right, Left } = Position;

// The headless route-drawing gesture shared by the editor and (soon) in-play
// building. These tests pin the gesture's behaviour exactly as it worked when
// it lived inside EditorView: the one-shot drag, click chaining including the
// U-turn/pending-frontier case, Esc/finish, ghost preview and passable gating.

type Drawing = "rail" | "road" | null;

function make(opts: {
  drawing?: Drawing;
  passable?: (c: { x: number; y: number }) => boolean;
} = {}) {
  // Each cfg.lay call is recorded as one batch, so tests can assert both WHAT
  // was laid and that a gesture commits in a single call (play needs the whole
  // route in one applyEdits).
  const laid: RouteStep[][] = [];
  let drawing: Drawing = opts.drawing !== undefined ? opts.drawing : "rail";
  const ctrl = createRouteDrawController({
    drawing: () => drawing,
    planOpts: () => ({ width: 5, height: 5, passable: opts.passable }),
    lay: steps => laid.push(steps),
  });
  return {
    ctrl,
    laid,
    all: () => laid.flat(),
    setDrawing: (d: Drawing) => {
      drawing = d;
    },
  };
}

const step = (id: string, a: Position, b: Position): RouteStep => ({ id, a, b });

// Arm a route head and extend it once so the U-turn/pending state exists:
// head at "1,1" exiting Right, then click the LEFT edge of "3,1" — the edge
// the track enters through — leaving "3,1" pending and the head on "2,1".
function armUTurn(ctrl: RouteDrawController) {
  ctrl.onZoneClick("1,1", Right);
  ctrl.onZoneClick("3,1", Left);
}

describe("routeDrawController — one-shot drag", () => {
  it("lays the anchor straight plus the whole route in ONE lay call", () => {
    const { ctrl, laid } = make();
    ctrl.onZoneDown("1,1", Right);
    ctrl.onZoneUp("3,1", Right);
    expect(laid).toEqual([
      [
        step("1,1", Left, Right), // anchor tile, straight in the pressed direction
        step("2,1", Left, Right),
        step("3,1", Left, Right),
      ],
    ]);
    expect(ctrl.state.pressFrom).toBeNull();
    // A drag is a one-shot: it never arms route mode.
    expect(ctrl.state.armed).toBeNull();
  });

  it("released on the SAME zone lays nothing (the click event handles it)", () => {
    const { ctrl, laid } = make();
    ctrl.onZoneDown("1,1", Right);
    ctrl.onZoneUp("1,1", Right);
    expect(laid).toEqual([]);
  });

  it("lays nothing when no route fits (passable gating)", () => {
    // Wall off the only corridor: everything except row 1 is impassable and
    // the row is cut at x=2, so "1,1" -> "4,1" cannot be planned.
    const { ctrl, laid } = make({
      passable: c => c.y === 1 && c.x !== 2,
    });
    ctrl.onZoneDown("1,1", Right);
    ctrl.onZoneUp("4,1", Right);
    expect(laid).toEqual([]);
    expect(ctrl.state.pressFrom).toBeNull();
  });
});

describe("routeDrawController — click chaining (route mode)", () => {
  it("first click arms the head without laying; the next click lays and advances", () => {
    const { ctrl, laid } = make();
    ctrl.onZoneClick("1,1", Right);
    expect(laid).toEqual([]);
    expect(ctrl.state.armed).toEqual({ id: "1,1", port: Right });
    expect(ctrl.isArmed("1,1", Right)).toBe(true);
    expect(ctrl.glowId).toBe("1,1");

    ctrl.onZoneClick("3,1", Right);
    expect(laid).toEqual([
      [
        step("1,1", Left, Right), // anchor laid only for the FIRST segment
        step("2,1", Left, Right),
        step("3,1", Left, Right),
      ],
    ]);
    // The head advanced to the clicked exit edge; the wedge switched from
    // "armed start" to "click again to finish".
    expect(ctrl.state.armed).toEqual({ id: "3,1", port: Right });
    expect(ctrl.isArmed("3,1", Right)).toBe(false);
    expect(ctrl.isFinish("3,1", Right)).toBe(true);

    // A further extension lays only the new cells — no anchor again.
    ctrl.onZoneClick("4,1", Right);
    expect(laid[1]).toEqual([step("4,1", Left, Right)]);
    expect(ctrl.state.armed).toEqual({ id: "4,1", port: Right });
  });

  it("clicking the head edge again finishes the route", () => {
    const { ctrl, laid } = make();
    ctrl.onZoneClick("1,1", Right);
    ctrl.onZoneClick("3,1", Right);
    ctrl.onZoneClick("3,1", Right); // the finish wedge
    expect(laid).toHaveLength(1); // nothing extra laid: no pending tile
    expect(ctrl.state.armed).toBeNull();
    expect(ctrl.state.routeStarted).toBe(false);
    expect(ctrl.glowId).toBeNull();
  });

  it("a click that cannot be routed changes nothing", () => {
    const { ctrl, laid } = make({ passable: c => c.y === 1 && c.x !== 2 });
    ctrl.onZoneClick("1,1", Right);
    ctrl.onZoneClick("4,1", Right); // beyond the wall at x=2
    expect(laid).toEqual([]);
    expect(ctrl.state.armed).toEqual({ id: "1,1", port: Right });
    expect(ctrl.state.routeStarted).toBe(false);
  });
});

describe("routeDrawController — U-turn / pending frontier", () => {
  it("clicking the incoming edge leaves the frontier tile undecided and trails the head", () => {
    const { ctrl, laid } = make();
    armUTurn(ctrl);
    // The frontier tile "3,1" was NOT laid — only the anchor and the tile
    // before it.
    expect(laid).toEqual([
      [step("1,1", Left, Right), step("2,1", Left, Right)],
    ]);
    expect(ctrl.state.pendingId).toBe("3,1");
    expect(ctrl.state.armed).toEqual({ id: "2,1", port: Right });
    // The glow follows the pending frontier, not the head.
    expect(ctrl.glowId).toBe("3,1");
  });

  it("clicking the pending tile locks it as a straight terminus", () => {
    const { ctrl, laid } = make();
    armUTurn(ctrl);
    ctrl.onZoneClick("3,1", Top); // any edge of the pending tile finishes
    expect(laid[1]).toEqual([step("3,1", Left, Right)]);
    expect(ctrl.state.pendingId).toBeNull();
    expect(ctrl.state.armed).toBeNull();
  });

  it("finishRoute (Esc) also locks the pending terminus", () => {
    const { ctrl, laid } = make();
    armUTurn(ctrl);
    ctrl.finishRoute();
    expect(laid[1]).toEqual([step("3,1", Left, Right)]);
    expect(ctrl.state.armed).toBeNull();
    expect(ctrl.state.routeStarted).toBe(false);
    expect(ctrl.state.pendingId).toBeNull();
  });

  it("finishRoute with no pending tile lays nothing", () => {
    const { ctrl, laid } = make();
    ctrl.onZoneClick("1,1", Right);
    ctrl.finishRoute();
    expect(laid).toEqual([]);
    expect(ctrl.state.armed).toBeNull();
  });
});

describe("routeDrawController — hover ghost preview", () => {
  it("previews anchor + route for a fresh armed head", () => {
    const { ctrl } = make();
    ctrl.onZoneClick("1,1", Right);
    ctrl.onZoneEnter("3,1", Right);
    expect(ctrl.previewSteps()).toEqual([
      step("1,1", Left, Right),
      step("2,1", Left, Right),
      step("3,1", Left, Right),
    ]);
  });

  it("previews the whole route for a drag, even onto the incoming edge", () => {
    const { ctrl } = make();
    ctrl.onZoneDown("1,1", Right);
    ctrl.onZoneEnter("3,1", Left); // would be a U-turn in click mode
    // A one-shot drag always draws its full route — no frontier trimming.
    expect(ctrl.previewSteps()).toEqual([
      step("1,1", Left, Right),
      step("2,1", Left, Right),
      step("3,1", Left, Right),
    ]);
  });

  it("trims the undecided frontier tile from a U-turn hover in route mode", () => {
    const { ctrl } = make();
    ctrl.onZoneClick("1,1", Right);
    ctrl.onZoneEnter("3,1", Left);
    expect(ctrl.previewSteps()).toEqual([
      step("1,1", Left, Right),
      step("2,1", Left, Right),
    ]);
  });

  it("omits the anchor once the route has started", () => {
    const { ctrl } = make();
    ctrl.onZoneClick("1,1", Right);
    ctrl.onZoneClick("3,1", Right); // route started, head now at 3,1
    ctrl.onZoneEnter("4,1", Right);
    expect(ctrl.previewSteps()).toEqual([step("4,1", Left, Right)]);
  });

  it("is empty for an unreachable hover target (null route)", () => {
    const { ctrl } = make({ passable: c => c.y === 1 && c.x !== 2 });
    ctrl.onZoneClick("1,1", Right);
    ctrl.onZoneEnter("4,1", Right);
    expect(ctrl.previewSteps()).toEqual([]);
  });

  it("clears when the hovered zone is left", () => {
    const { ctrl } = make();
    ctrl.onZoneClick("1,1", Right);
    ctrl.onZoneEnter("3,1", Right);
    ctrl.onZoneLeave("3,1", Right);
    expect(ctrl.state.hoverPort).toBeNull();
    expect(ctrl.previewSteps()).toEqual([]);
  });

  it("leaving a DIFFERENT zone than the hovered one keeps the hover", () => {
    const { ctrl } = make();
    ctrl.onZoneEnter("3,1", Right);
    ctrl.onZoneLeave("3,1", Top); // stale leave from another edge
    expect(ctrl.state.hoverPort).toEqual({ id: "3,1", port: Right });
  });
});

describe("routeDrawController — gating and resets", () => {
  it("does nothing at all while drawing() is null", () => {
    const { ctrl, laid } = make({ drawing: null });
    ctrl.onZoneDown("1,1", Right);
    ctrl.onZoneUp("3,1", Right);
    ctrl.onZoneClick("1,1", Right);
    ctrl.onZoneEnter("2,1", Right);
    expect(laid).toEqual([]);
    expect(ctrl.state.pressFrom).toBeNull();
    expect(ctrl.state.armed).toBeNull();
    expect(ctrl.state.hoverPort).toBeNull();
    expect(ctrl.previewSteps()).toEqual([]);
  });

  it("toolChanged forgets press + hover and finishes an open route", () => {
    const { ctrl, laid } = make();
    armUTurn(ctrl);
    ctrl.onZoneEnter("4,1", Right);
    ctrl.toolChanged();
    // The pending frontier was locked as a terminus on the way out.
    expect(laid[1]).toEqual([step("3,1", Left, Right)]);
    expect(ctrl.state.pressFrom).toBeNull();
    expect(ctrl.state.hoverPort).toBeNull();
    expect(ctrl.state.armed).toBeNull();
    expect(ctrl.state.pendingId).toBeNull();
  });

  it("dropAnchors forgets the press and head WITHOUT laying (world re-based)", () => {
    const { ctrl, laid } = make();
    ctrl.onZoneClick("1,1", Right);
    ctrl.onZoneDown("2,1", Right);
    ctrl.dropAnchors();
    expect(laid).toEqual([]);
    expect(ctrl.state.armed).toBeNull();
    expect(ctrl.state.pressFrom).toBeNull();
  });

  it("clearPress abandons only the in-progress press", () => {
    const { ctrl } = make();
    ctrl.onZoneClick("1,1", Right); // armed head
    ctrl.onZoneDown("2,1", Right);
    ctrl.clearPress();
    expect(ctrl.state.pressFrom).toBeNull();
    expect(ctrl.state.armed).toEqual({ id: "1,1", port: Right });
  });
});
