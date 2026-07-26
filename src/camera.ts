// Viewport camera for the board: pan + zoom over a world that no longer fits on
// screen.
//
// Worlds are sized by their content now, so a big one is several thousand pixels
// across at the native 200px tile. Rather than shrink the tiles (which would
// break every px-based piece of road geometry), the board is rendered at its
// natural size and this moves a window over it.
//
// Pure state + maths, deliberately free of the DOM: the views own the wheel and
// pointer listeners and hand the numbers here, which keeps the awkward parts
// (zoom about a point, clamping, fit) unit-testable.

export interface Camera {
  x: number; // world px at the viewport's left edge, before scaling
  y: number;
  zoom: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 2;

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1 };
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

// Breathing room around the world, in SCREEN px — the same on a zoomed-out map
// as a zoomed-in one, because it is about the edge of the SCREEN, not about the
// board's scale.
//
// The board used to be given room by the page's own padding, which is the wrong
// place for it: it made the page taller than the window (see TestView.vue) and
// still pinned a big world's edge hard against the viewport, so the outermost
// row of tiles sat under the frame's vignette with nothing to push it off. This
// is the margin instead — the fit leaves it, and a pan may take it.
export const WORLD_MARGIN = 48;

// Keep the world in reach. A world smaller than the viewport is centred on that
// axis; a larger one may be scrolled until its far edge meets the far edge of the
// viewport plus the margin, never past that — panning into an empty void loses
// the board and is the quickest way to make a big map feel broken.
export function clampCamera(
  cam: Camera,
  world: Size,
  viewport: Size,
  margin = WORLD_MARGIN,
): Camera {
  const zoom = clampZoom(cam.zoom);
  const scaled = { width: world.width * zoom, height: world.height * zoom };
  const axis = (pos: number, worldLen: number, viewLen: number) => {
    if (worldLen <= viewLen) return (worldLen - viewLen) / 2 / zoom; // centred
    // The slack is the margin at BOTH ends: `-margin` pushes the world's leading
    // edge that far off the viewport's, and the far bound does the same at the
    // other end.
    return Math.min(
      Math.max(pos, -margin / zoom),
      (worldLen - viewLen + margin) / zoom,
    );
  };
  return {
    zoom,
    x: axis(cam.x, scaled.width, viewport.width),
    y: axis(cam.y, scaled.height, viewport.height),
  };
}

export function panBy(cam: Camera, dxPx: number, dyPx: number, world: Size, viewport: Size): Camera {
  // The drag is in SCREEN px; at zoom 0.5 a 10px drag should move the world 20px,
  // otherwise a zoomed-out board feels glued down.
  return clampCamera(
    { ...cam, x: cam.x - dxPx / cam.zoom, y: cam.y - dyPx / cam.zoom },
    world,
    viewport,
  );
}

// Zoom about a fixed point (the cursor), so the tile under the pointer stays put
// — zooming about the viewport's corner instead makes the board appear to run
// away from you.
export function zoomAt(
  cam: Camera,
  factor: number,
  pointer: { x: number; y: number },
  world: Size,
  viewport: Size,
): Camera {
  const zoom = clampZoom(cam.zoom * factor);
  if (zoom === cam.zoom) return cam;
  // World point currently under the pointer, held invariant across the change.
  const worldX = cam.x + pointer.x / cam.zoom;
  const worldY = cam.y + pointer.y / cam.zoom;
  return clampCamera(
    { zoom, x: worldX - pointer.x / zoom, y: worldY - pointer.y / zoom },
    world,
    viewport,
  );
}

// The zoom that shows the whole world at once, with a little breathing room —
// `WORLD_MARGIN` at each side, the same gap a pan may open anywhere else.
// Never zooms past 1: a small board is shown at its natural size rather than
// blown up, which would just make the sprites soft.
export function fitZoom(world: Size, viewport: Size, pad = WORLD_MARGIN * 2): number {
  if (world.width <= 0 || world.height <= 0) return 1;
  const z = Math.min(
    (viewport.width - pad) / world.width,
    (viewport.height - pad) / world.height,
  );
  return clampZoom(Math.min(1, z));
}

export function fitCamera(world: Size, viewport: Size, pad = WORLD_MARGIN * 2): Camera {
  const zoom = fitZoom(world, viewport, pad);
  return clampCamera({ x: 0, y: 0, zoom }, world, viewport);
}

// The CSS transform for the board element. `translate` is applied AFTER `scale`
// in the string, i.e. read right-to-left, so the offset is in scaled px — matching
// how the camera stores it.
export function cameraTransform(cam: Camera): string {
  return `scale(${cam.zoom}) translate(${-cam.x}px, ${-cam.y}px)`;
}
