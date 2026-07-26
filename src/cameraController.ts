import { reactive } from "vue";
import {
  Camera,
  Size,
  createCamera,
  cameraTransform,
  fitCamera,
  panBy,
  zoomAt,
} from "@/camera";

// The DOM glue around the pure camera maths in `camera.ts`: pointer drag, wheel
// zoom, and the "is the board bigger than the window" question.
//
// Both boards (PlayView and the test stage) need identical behaviour, and a
// camera that behaves differently between them would be its own bug — so the
// wiring lives here once rather than being copied into two class components.
// The views supply how to measure the world and the window; everything else is
// this controller's.
export interface CameraController {
  readonly state: { camera: Camera; panning: boolean };
  readonly transform: string;
  readonly overflows: boolean;
  fit(): void;
  zoomBy(factor: number): void;
  onWheel(e: WheelEvent, viewportEl: HTMLElement | undefined): void;
  onPointerDown(e: PointerEvent): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(e: PointerEvent): void;
  reclamp(): void;
}

// A few px of slop before a drag counts as a pan, so a click on a tile is still a
// click rather than a one-pixel pan that swallows it.
const PAN_SLOP = 4;

export function createCameraController(
  worldSize: () => Size,
  viewportSize: () => Size,
): CameraController {
  const state = reactive({ camera: createCamera(), panning: false }) as {
    camera: Camera;
    panning: boolean;
  };
  let pointerId: number | null = null;
  let moved = 0;
  // Whether this gesture has taken pointer capture yet — only a real drag does.
  let captured = false;

  return {
    state,
    get transform() {
      return cameraTransform(state.camera);
    },
    get overflows() {
      const w = worldSize();
      const v = viewportSize();
      return w.width > v.width || w.height > v.height;
    },
    fit() {
      state.camera = fitCamera(worldSize(), viewportSize());
    },
    zoomBy(factor: number) {
      const v = viewportSize();
      state.camera = zoomAt(
        state.camera,
        factor,
        { x: v.width / 2, y: v.height / 2 },
        worldSize(),
        v,
      );
    },
    onWheel(e: WheelEvent, viewportEl: HTMLElement | undefined) {
      if (!viewportEl) return;
      const r = viewportEl.getBoundingClientRect();
      state.camera = zoomAt(
        state.camera,
        e.deltaY < 0 ? 1.12 : 1 / 1.12,
        { x: e.clientX - r.left, y: e.clientY - r.top },
        worldSize(),
        viewportSize(),
      );
    },
    // Which button starts a pan is the CALLER's policy, not this controller's:
    // the play boards pan on a plain left drag, but in the editor a left drag
    // belongs to the connect tool (edge dot → edge dot) and stealing it would
    // make the board unbuildable, so it pans on middle-drag or space-drag.
    onPointerDown(e: PointerEvent) {
      pointerId = e.pointerId;
      moved = 0;
      captured = false;
      // Deliberately NOT capturing here. Pointer capture retargets every later
      // pointer event — and the `click` derived from them — to the capturing
      // element, so capturing on press meant a click that started on a switch,
      // signal or depot was delivered to the viewport instead and the widget's
      // handler never ran. Hit-testing is unaffected by capture, so the controls
      // still looked perfectly clickable while doing nothing. Capture is taken
      // below, once the gesture is actually a drag.
    },
    onPointerMove(e: PointerEvent) {
      if (pointerId !== e.pointerId) return;
      moved += Math.abs(e.movementX) + Math.abs(e.movementY);
      if (moved < PAN_SLOP) return;
      // Now it is a pan: capture so it keeps tracking if the cursor leaves the
      // viewport mid-drag.
      if (!captured) {
        (e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
        captured = true;
      }
      state.panning = true;
      state.camera = panBy(state.camera, e.movementX, e.movementY, worldSize(), viewportSize());
    },
    onPointerUp(e: PointerEvent) {
      if (pointerId !== e.pointerId) return;
      pointerId = null;
      captured = false;
      // Cleared a tick later so the click that follows a drag sees `panning` and
      // is ignored, instead of landing on whatever tile the drag ended over.
      setTimeout(() => {
        state.panning = false;
      }, 0);
    },
    // Re-clamp without moving: a window that grew could otherwise leave the board
    // stranded against an edge with empty space beside it.
    reclamp() {
      state.camera = panBy(state.camera, 0, 0, worldSize(), viewportSize());
    },
  };
}
