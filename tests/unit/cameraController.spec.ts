import { describe, it, expect } from "vitest";
import { createCameraController } from "@/cameraController";
import { MIN_ZOOM, MAX_ZOOM } from "@/camera";

// The controller is the DOM glue, but its interesting part — which pointer owns
// the gesture, and what two fingers do to the camera — is plain bookkeeping over
// the pure maths in camera.ts. The unit environment is `node`, so PointerEvents
// are hand-built: the controller reads pointerId, pointerType, clientX/Y and
// currentTarget, and nothing else.

const world = { width: 4000, height: 3000 }; // a 20x15 board at 200px tiles
const viewport = { width: 800, height: 600 };

// A viewport element at the window's origin, so client px and viewport-local px
// coincide and the expected numbers stay readable. `setPointerCapture` is a
// no-op stub — the real one only affects event routing, which these tests drive
// by hand anyway.
const el = {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: viewport.width, height: viewport.height }),
  setPointerCapture: () => {},
} as unknown as HTMLElement;

type Ev = { id: number; x: number; y: number; type?: string; button?: number };
const ev = ({ id, x, y, type = "touch", button = 0 }: Ev) =>
  ({
    pointerId: id,
    pointerType: type,
    clientX: x,
    clientY: y,
    button,
    currentTarget: el,
  }) as unknown as PointerEvent;

const make = () => createCameraController(() => world, () => viewport);

describe("one pointer pans", () => {
  it("drags the board by the pointer's travel, not by movementX", () => {
    // `movementX` is absent on the events below on purpose: it is undefined or
    // zero for touch pointers in several engines, and reading it made a
    // one-finger drag move the board by exactly nothing on a phone.
    const cam = make();
    cam.state.camera = { x: 500, y: 500, zoom: 1 };
    cam.onPointerDown(ev({ id: 1, x: 400, y: 300 }));
    cam.onPointerMove(ev({ id: 1, x: 340, y: 260 }));
    // Dragged 60px left and 40px up, so the camera walks the same way into the
    // world (at zoom 1, screen px and world px are the same distance).
    expect(cam.state.camera.x).toBe(560);
    expect(cam.state.camera.y).toBe(540);
    expect(cam.state.panning).toBe(true);
  });

  it("ignores a wobble below the slop, so a tap is still a tap", () => {
    const cam = make();
    cam.state.camera = { x: 500, y: 500, zoom: 1 };
    cam.onPointerDown(ev({ id: 1, x: 400, y: 300 }));
    cam.onPointerMove(ev({ id: 1, x: 401, y: 301 }));
    expect(cam.state.camera).toMatchObject({ x: 500, y: 500 });
    expect(cam.state.panning).toBe(false);
  });

  it("does not pan a pointer the view refused", () => {
    const cam = make();
    cam.state.camera = { x: 500, y: 500, zoom: 1 };
    cam.onPointerDown(ev({ id: 1, x: 400, y: 300 }), { pan: false });
    cam.onPointerMove(ev({ id: 1, x: 200, y: 100 }));
    expect(cam.state.camera).toMatchObject({ x: 500, y: 500 });
    expect(cam.state.panning).toBe(false);
  });
});

describe("two fingers pinch", () => {
  it("spreading zooms in, and about the point between the fingers", () => {
    const cam = make();
    cam.state.camera = { x: 0, y: 0, zoom: 0.5 };
    // Fingers 200px apart, centred at (400, 300) — the viewport's middle.
    cam.onPointerDown(ev({ id: 1, x: 300, y: 300 }));
    cam.onPointerDown(ev({ id: 2, x: 500, y: 300 }));
    expect(cam.pinching).toBe(true);
    // The world point under the midpoint before the gesture...
    const before = { x: 0 + 400 / 0.5, y: 0 + 300 / 0.5 };
    // ...spread to 400px apart: a factor of two.
    cam.onPointerMove(ev({ id: 1, x: 200, y: 300 }));
    cam.onPointerMove(ev({ id: 2, x: 600, y: 300 }));
    expect(cam.state.camera.zoom).toBeCloseTo(1, 6);
    // ...is still under it afterwards. That invariant is the whole point of
    // zooming about the midpoint: the board must not run away from the fingers.
    const after = {
      x: cam.state.camera.x + 400 / cam.state.camera.zoom,
      y: cam.state.camera.y + 300 / cam.state.camera.zoom,
    };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("closing the fingers zooms out", () => {
    const cam = make();
    cam.state.camera = { x: 0, y: 0, zoom: 1 };
    cam.onPointerDown(ev({ id: 1, x: 200, y: 300 }));
    cam.onPointerDown(ev({ id: 2, x: 600, y: 300 }));
    cam.onPointerMove(ev({ id: 1, x: 300, y: 300 }));
    cam.onPointerMove(ev({ id: 2, x: 500, y: 300 }));
    expect(cam.state.camera.zoom).toBeCloseTo(0.5, 6);
  });

  it("two fingers drag as well as spread", () => {
    const cam = make();
    cam.state.camera = { x: 500, y: 500, zoom: 1 };
    cam.onPointerDown(ev({ id: 1, x: 300, y: 300 }));
    cam.onPointerDown(ev({ id: 2, x: 500, y: 300 }));
    // Same span, midpoint moved 100px left: a pure two-finger pan.
    cam.onPointerMove(ev({ id: 1, x: 200, y: 300 }));
    cam.onPointerMove(ev({ id: 2, x: 400, y: 300 }));
    expect(cam.state.camera.zoom).toBe(1);
    expect(cam.state.camera.x).toBe(600);
  });

  it("stays inside the zoom limits however hard you spread", () => {
    const cam = make();
    cam.state.camera = { x: 0, y: 0, zoom: 1 };
    cam.onPointerDown(ev({ id: 1, x: 399, y: 300 }));
    cam.onPointerDown(ev({ id: 2, x: 401, y: 300 }));
    cam.onPointerMove(ev({ id: 1, x: 0, y: 300 }));
    cam.onPointerMove(ev({ id: 2, x: 800, y: 300 }));
    expect(cam.state.camera.zoom).toBe(MAX_ZOOM);
    cam.onPointerMove(ev({ id: 1, x: 399, y: 300 }));
    cam.onPointerMove(ev({ id: 2, x: 401, y: 300 }));
    expect(cam.state.camera.zoom).toBe(MIN_ZOOM);
  });

  it("pinches even where a single pointer may not pan — a pinch outranks a tool", () => {
    // The editor's case: one finger draws, so the view passes `pan: false`. Two
    // fingers still have to move the board, or a touchscreen cannot reach the
    // rest of a big level at all.
    const cam = make();
    cam.state.camera = { x: 0, y: 0, zoom: 0.5 };
    cam.onPointerDown(ev({ id: 1, x: 300, y: 300 }), { pan: false });
    cam.onPointerMove(ev({ id: 1, x: 100, y: 300 }));
    expect(cam.state.camera.x).toBe(0); // one finger drew, it did not pan
    cam.onPointerDown(ev({ id: 2, x: 500, y: 300 }), { pan: false });
    cam.onPointerMove(ev({ id: 1, x: 0, y: 300 }));
    cam.onPointerMove(ev({ id: 2, x: 800, y: 300 }));
    expect(cam.state.camera.zoom).toBeGreaterThan(0.5);
  });

  it("a second finger cancels the pan in progress instead of fighting it", () => {
    const cam = make();
    cam.state.camera = { x: 500, y: 500, zoom: 1 };
    cam.onPointerDown(ev({ id: 1, x: 400, y: 300 }));
    cam.onPointerMove(ev({ id: 1, x: 300, y: 300 })); // pans
    expect(cam.state.camera.x).toBe(600);
    cam.onPointerDown(ev({ id: 2, x: 500, y: 300 }));
    // Finger 1 alone can no longer drive the camera: the midpoint does now, and
    // a move of one finger is half a midpoint move (plus the spread it opens).
    const x = cam.state.camera.x;
    cam.onPointerMove(ev({ id: 1, x: 300, y: 300 }));
    expect(cam.state.camera.x).toBe(x);
  });

  it("a mouse button is never a second finger", () => {
    const cam = make();
    cam.onPointerDown(ev({ id: 1, x: 300, y: 300 }));
    cam.onPointerDown(ev({ id: 2, x: 500, y: 300, type: "mouse" }));
    expect(cam.pinching).toBe(false);
  });
});

describe("ending a gesture", () => {
  it("hands the board to the finger still down when one lifts", () => {
    const cam = make();
    cam.state.camera = { x: 500, y: 500, zoom: 1 };
    cam.onPointerDown(ev({ id: 1, x: 300, y: 300 }));
    cam.onPointerDown(ev({ id: 2, x: 500, y: 300 }));
    cam.onPointerUp(ev({ id: 2, x: 500, y: 300 }));
    expect(cam.pinching).toBe(false);
    // Finger 1 carries on panning from where it is — no lift-and-retouch, and no
    // jump from a stale baseline.
    cam.onPointerMove(ev({ id: 1, x: 250, y: 300 }));
    expect(cam.state.camera.x).toBe(550);
  });

  it("re-baselines rather than jumping when one of three fingers lifts", () => {
    const cam = make();
    cam.state.camera = { x: 0, y: 0, zoom: 1 };
    cam.onPointerDown(ev({ id: 1, x: 300, y: 300 }));
    cam.onPointerDown(ev({ id: 2, x: 500, y: 300 }));
    cam.onPointerDown(ev({ id: 3, x: 100, y: 300 }));
    const zoom = cam.state.camera.zoom;
    // Dropping finger 1 leaves the pair (2, 3), which spans a very different
    // distance. Without a re-baseline the next move reads that as an enormous
    // spread; with one, standing still changes nothing.
    cam.onPointerUp(ev({ id: 1, x: 300, y: 300 }));
    cam.onPointerMove(ev({ id: 2, x: 500, y: 300 }));
    cam.onPointerMove(ev({ id: 3, x: 100, y: 300 }));
    expect(cam.state.camera.zoom).toBe(zoom);
  });

  it("releases the gesture when the last finger lifts, even one that never panned", () => {
    // EditorView's shape: neither finger was allowed to pan on its own, so
    // nothing here owns `pointerId`. `panning` still has to fall, or the board
    // keeps the grabbing cursor and swallows every click from then on.
    const cam = make();
    cam.onPointerDown(ev({ id: 1, x: 300, y: 300 }), { pan: false });
    cam.onPointerDown(ev({ id: 2, x: 500, y: 300 }), { pan: false });
    expect(cam.state.panning).toBe(true);
    cam.onPointerUp(ev({ id: 1, x: 300, y: 300 }));
    cam.onPointerUp(ev({ id: 2, x: 500, y: 300 }));
    return new Promise<void>(resolve =>
      setTimeout(() => {
        expect(cam.state.panning).toBe(false);
        expect(cam.pinching).toBe(false);
        resolve();
      }, 0),
    );
  });

  it("a fresh pinch after a finished one starts from its own baseline", () => {
    const cam = make();
    cam.state.camera = { x: 0, y: 0, zoom: 1 };
    cam.onPointerDown(ev({ id: 1, x: 300, y: 300 }));
    cam.onPointerDown(ev({ id: 2, x: 500, y: 300 }));
    cam.onPointerMove(ev({ id: 1, x: 200, y: 300 }));
    cam.onPointerMove(ev({ id: 2, x: 600, y: 300 }));
    cam.onPointerUp(ev({ id: 1, x: 200, y: 300 }));
    cam.onPointerUp(ev({ id: 2, x: 600, y: 300 }));
    const zoom = cam.state.camera.zoom;
    cam.onPointerDown(ev({ id: 3, x: 350, y: 300 }));
    cam.onPointerDown(ev({ id: 4, x: 450, y: 300 }));
    cam.onPointerMove(ev({ id: 3, x: 350, y: 300 }));
    cam.onPointerMove(ev({ id: 4, x: 450, y: 300 }));
    expect(cam.state.camera.zoom).toBe(zoom);
  });
});
