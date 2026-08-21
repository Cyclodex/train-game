import { reactive } from "vue";
import {
  Camera,
  Insets,
  NO_INSETS,
  Size,
  createCamera,
  cameraTransform,
  fitCamera,
  panBy,
  zoomAt,
} from "@/camera";

// The DOM glue around the pure camera maths in `camera.ts`: pointer drag, wheel
// zoom, pinch zoom, and the "is the board bigger than the window" question.
//
// All three boards (PlayView, EditorView and the test stage) need identical
// behaviour, and a camera that behaves differently between them would be its own
// bug — so the wiring lives here once rather than being copied into three class
// components. The views supply how to measure the world and the window;
// everything else is this controller's.
export interface CameraController {
  readonly state: { camera: Camera; panning: boolean };
  readonly transform: string;
  readonly overflows: boolean;
  /** True while two fingers are on the board — the views suppress tile clicks. */
  readonly pinching: boolean;
  fit(): void;
  zoomBy(factor: number): void;
  onWheel(e: WheelEvent, viewportEl: HTMLElement | undefined): void;
  onPointerDown(e: PointerEvent, opts?: PointerDownOptions): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(e: PointerEvent): void;
  reclamp(): void;
}

export interface PointerDownOptions {
  // May THIS pointer drag the board? The caller's policy — see `onPointerDown`.
  // Defaults to true.
  pan?: boolean;
}

// A few px of slop before a drag counts as a pan, so a click on a tile is still a
// click rather than a one-pixel pan that swallows it.
const PAN_SLOP = 4;

// A live finger: where it is (CLIENT px, the one frame of reference every pointer
// event agrees on) and whether the view let it pan on its own.
interface Touch {
  x: number;
  y: number;
  pan: boolean;
}

// `insets` is the HUD chrome that floats OVER the board (see camera.ts): the
// viewport is the whole window, and this keeps the world's content clear of the
// score card and the dock without shrinking the board's own area.
export function createCameraController(
  worldSize: () => Size,
  viewportSize: () => Size,
  insets: () => Insets = () => NO_INSETS,
): CameraController {
  const state = reactive({ camera: createCamera(), panning: false }) as {
    camera: Camera;
    panning: boolean;
  };
  let pointerId: number | null = null;
  let moved = 0;
  // Whether this gesture has taken pointer capture yet — only a real drag does.
  let captured = false;
  // The panning pointer's last position, in client px.
  //
  // NOT `e.movementX`: that is undefined-or-zero for touch pointers in several
  // engines (notably WebKit), so a one-finger drag on a phone moved the board by
  // zero and the map felt glued down. Tracking the position ourselves is the same
  // number for a mouse — the pointer is never locked here — and the only one that
  // exists for a finger.
  let last: { x: number; y: number } | null = null;

  // Every finger currently on the board, keyed by pointerId. A mouse or pen
  // pointer is NOT in here: a pinch is a touch gesture, and mixing the two would
  // make a second mouse button look like a second finger.
  const touches = new Map<number, Touch>();
  // The previous frame of a two-finger gesture — the span between the fingers and
  // their midpoint (client px). Null whenever fewer than two fingers are down.
  let pinch: { dist: number; x: number; y: number } | null = null;
  // The element the gesture started on, kept so a pinch can convert its midpoint
  // out of client space without a second `currentTarget` to read.
  let viewportEl: HTMLElement | null = null;

  const twoFingers = (): [Touch, Touch] | null => {
    if (touches.size < 2) return null;
    const [a, b] = [...touches.values()];
    return [a, b];
  };

  const span = (a: Touch, b: Touch) => ({
    dist: Math.hypot(a.x - b.x, a.y - b.y),
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  // Client px → viewport-local px, the frame `zoomAt` wants its focus point in.
  const toLocal = (p: { x: number; y: number }) => {
    const r = viewportEl?.getBoundingClientRect?.();
    return r ? { x: p.x - r.left, y: p.y - r.top } : p;
  };

  const endGesture = () => {
    pointerId = null;
    captured = false;
    last = null;
    // Cleared a tick later so the click that follows a drag or a pinch sees
    // `panning` and is ignored, instead of landing on whatever tile the gesture
    // ended over.
    setTimeout(() => {
      state.panning = false;
    }, 0);
  };

  return {
    state,
    get transform() {
      return cameraTransform(state.camera);
    },
    get pinching() {
      return pinch !== null;
    },
    get overflows() {
      const w = worldSize();
      const v = viewportSize();
      const i = insets();
      // Against the USABLE strip: a world that only fits behind the dock does
      // overflow, and the zoom controls have to be offered for it.
      return w.width > v.width - i.left - i.right || w.height > v.height - i.top - i.bottom;
    },
    fit() {
      state.camera = fitCamera(worldSize(), viewportSize(), undefined, insets());
    },
    zoomBy(factor: number) {
      const v = viewportSize();
      const i = insets();
      state.camera = zoomAt(
        state.camera,
        factor,
        // About the middle of the usable strip, not the window's — otherwise a
        // zoom step drifts the board under the chrome.
        {
          x: (i.left + v.width - i.right) / 2,
          y: (i.top + v.height - i.bottom) / 2,
        },
        worldSize(),
        v,
        i,
      );
    },
    onWheel(e: WheelEvent, el: HTMLElement | undefined) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      state.camera = zoomAt(
        state.camera,
        e.deltaY < 0 ? 1.12 : 1 / 1.12,
        { x: e.clientX - r.left, y: e.clientY - r.top },
        worldSize(),
        viewportSize(),
        insets(),
      );
    },
    // Which pointer may start a pan is the CALLER's policy, not this controller's:
    // the play boards pan on a plain left drag, but in the editor a left drag
    // belongs to the connect tool (edge dot → edge dot) and stealing it would
    // make the board unbuildable, so it pans on middle-drag or space-drag. The
    // caller says so with `opts.pan`.
    //
    // A PINCH IS NOT SUBJECT TO THAT POLICY, which is why every view must call
    // this for every pointer rather than returning early on the ones it does not
    // want to pan. Two fingers cannot be confused with a drawing gesture — no
    // tool in this app takes two — so the controller has to see the second finger
    // even where the first one belongs to somebody else. That is the whole reason
    // this takes an options bag instead of the view simply not calling it.
    onPointerDown(e: PointerEvent, opts: PointerDownOptions = {}) {
      const mayPan = opts.pan ?? true;
      if (e.pointerType === "touch") {
        viewportEl = (e.currentTarget as HTMLElement | null) ?? viewportEl;
        touches.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: mayPan });
        const two = twoFingers();
        if (two) {
          // The second finger landed: this is a pinch from here on. Whatever
          // single-finger pan was in progress is folded into it — the midpoint
          // carries the drag — so drop the pan pointer rather than letting both
          // move the board at once.
          pinch = span(two[0], two[1]);
          pointerId = null;
          captured = false;
          last = null;
          // Immediately, not after the slop: a pinch is never a click, and a tile
          // must not fire one when the fingers lift.
          state.panning = true;
          return;
        }
      }
      if (!mayPan) return;
      pointerId = e.pointerId;
      moved = 0;
      captured = false;
      last = { x: e.clientX, y: e.clientY };
      // Deliberately NOT capturing here. Pointer capture retargets every later
      // pointer event — and the `click` derived from them — to the capturing
      // element, so capturing on press meant a click that started on a switch,
      // signal or depot was delivered to the viewport instead and the widget's
      // handler never ran. Hit-testing is unaffected by capture, so the controls
      // still looked perfectly clickable while doing nothing. Capture is taken
      // below, once the gesture is actually a drag.
    },
    onPointerMove(e: PointerEvent) {
      if (e.pointerType === "touch" && touches.has(e.pointerId)) {
        const t = touches.get(e.pointerId)!;
        t.x = e.clientX;
        t.y = e.clientY;
      }
      const two = pinch && twoFingers();
      if (pinch && two) {
        const now = span(two[0], two[1]);
        // Zoom about the PREVIOUS midpoint, then translate by how far the
        // midpoint travelled. Two steps, and the order is not interchangeable:
        // scaling about the NEW midpoint and then panning by the delta shifts the
        // board by an extra `delta * (1/oldZoom - 1/newZoom)` every frame, so the
        // world slides out from under the fingers whenever a pinch also drifts —
        // which every real pinch does. This pair holds the exact invariant the
        // wheel holds at the cursor: the world point under the midpoint when the
        // frame began is under the midpoint when it ends.
        if (pinch.dist > 0 && now.dist > 0) {
          state.camera = zoomAt(
            state.camera,
            now.dist / pinch.dist,
            toLocal(pinch),
            worldSize(),
            viewportSize(),
            insets(),
          );
        }
        // ...and two fingers DRAG as well as spread: a pinch that could only
        // scale would fight the user every time the gesture drifts.
        state.camera = panBy(
          state.camera,
          now.x - pinch.x,
          now.y - pinch.y,
          worldSize(),
          viewportSize(),
          insets(),
        );
        pinch = now;
        return;
      }
      if (pointerId !== e.pointerId || !last) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved < PAN_SLOP) return;
      // Now it is a pan: capture so it keeps tracking if the cursor leaves the
      // viewport mid-drag.
      if (!captured) {
        (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
        captured = true;
      }
      state.panning = true;
      state.camera = panBy(state.camera, dx, dy, worldSize(), viewportSize(), insets());
    },
    onPointerUp(e: PointerEvent) {
      const wasTouch = e.pointerType === "touch";
      if (wasTouch) touches.delete(e.pointerId);
      if (pinch) {
        const rest = twoFingers();
        if (rest) {
          // Three fingers down and one lifted: the gesture goes on, but between a
          // DIFFERENT pair. Re-baseline, or the next move reads the change of
          // pair as an enormous spread and the board jumps.
          pinch = span(rest[0], rest[1]);
          return;
        }
        pinch = null;
        // One finger left of a pinch keeps panning, if that finger was allowed to
        // pan on its own. Lifting a thumb mid-gesture and dragging on is ordinary
        // map handling; making the user let go and start again is not. It is past
        // the slop already — the gesture has plainly moved.
        const carry = [...touches.entries()].find(([, t]) => t.pan);
        if (carry) {
          pointerId = carry[0];
          last = { x: carry[1].x, y: carry[1].y };
          moved = PAN_SLOP;
          captured = false;
          return;
        }
        pointerId = null;
      }
      // The gesture is over when the pointer that owned it lifts — or, for touch,
      // when the LAST finger does. Without that second clause a finger that never
      // owned the pan (the editor's, where one finger draws) would leave
      // `panning` stuck true, and with it the grabbing cursor and a board that
      // swallows every click.
      if (pointerId === e.pointerId || (wasTouch && touches.size === 0)) endGesture();
    },
    // Re-clamp without moving: a window that grew could otherwise leave the board
    // stranded against an edge with empty space beside it.
    reclamp() {
      state.camera = panBy(state.camera, 0, 0, worldSize(), viewportSize(), insets());
    },
  };
}
