import { describe, it, expect } from "vitest";
import {
  clampCamera,
  panBy,
  zoomAt,
  fitZoom,
  fitCamera,
  cameraTransform,
  MIN_ZOOM,
  MAX_ZOOM,
  WORLD_MARGIN,
} from "@/camera";

const world = { width: 4000, height: 3000 }; // a 20x15 board at 200px tiles
const viewport = { width: 1200, height: 800 };

describe("camera clamping", () => {
  it("never lets the world be panned off screen, but leaves a margin to push it off the edge", () => {
    const far = clampCamera({ x: 99999, y: 99999, zoom: 1 }, world, viewport);
    // The furthest you may scroll is a MARGIN past where the world's far edge
    // meets the viewport's — enough to lift the outermost row of tiles off the
    // frame, and no more. Panning further is panning into empty space, which
    // loses the board.
    expect(far.x).toBe(world.width - viewport.width + WORLD_MARGIN);
    expect(far.y).toBe(world.height - viewport.height + WORLD_MARGIN);
    const near = clampCamera({ x: -99999, y: -99999, zoom: 1 }, world, viewport);
    expect(near).toMatchObject({ x: -WORLD_MARGIN, y: -WORLD_MARGIN });
  });

  it("keeps the margin a SCREEN distance, not a world one", () => {
    // Zoomed out, the same gap on screen is a bigger slice of the world — so the
    // camera offset (world px) doubles at zoom 0.5. A margin measured in world px
    // instead would shrink to nothing exactly when a big map needs it most.
    const out = clampCamera({ x: -99999, y: 0, zoom: 0.5 }, world, viewport);
    expect(out.x).toBe(-WORLD_MARGIN / 0.5);
  });

  it("centres a world smaller than the viewport instead of pinning it", () => {
    const small = { width: 600, height: 400 };
    const cam = clampCamera({ x: 0, y: 0, zoom: 1 }, small, viewport);
    expect(cam.x).toBe((600 - 1200) / 2); // negative = centred, board inset
    expect(cam.y).toBe((400 - 800) / 2);
  });

  it("holds zoom within its limits", () => {
    expect(clampCamera({ x: 0, y: 0, zoom: 99 }, world, viewport).zoom).toBe(MAX_ZOOM);
    expect(clampCamera({ x: 0, y: 0, zoom: 0.001 }, world, viewport).zoom).toBe(MIN_ZOOM);
  });
});

describe("panBy", () => {
  it("moves the world with the drag, not against it", () => {
    // Dragging right (+dx) should reveal what is to the LEFT, i.e. decrease x.
    const cam = panBy({ x: 500, y: 500, zoom: 1 }, 100, 50, world, viewport);
    expect(cam.x).toBe(400);
    expect(cam.y).toBe(450);
  });

  it("scales the drag by the zoom so a zoomed-out board is not glued down", () => {
    // At 0.5 zoom a 100px drag crosses 200px of world.
    const cam = panBy({ x: 1000, y: 0, zoom: 0.5 }, 100, 0, world, viewport);
    expect(cam.x).toBe(800);
  });
});

describe("zoomAt", () => {
  it("keeps the point under the cursor fixed", () => {
    const before = { x: 400, y: 300, zoom: 1 };
    const pointer = { x: 600, y: 400 };
    const worldUnderPointer = {
      x: before.x + pointer.x / before.zoom,
      y: before.y + pointer.y / before.zoom,
    };
    const after = zoomAt(before, 1.5, pointer, world, viewport);
    expect(after.zoom).toBeCloseTo(1.5, 6);
    expect(after.x + pointer.x / after.zoom).toBeCloseTo(worldUnderPointer.x, 6);
    expect(after.y + pointer.y / after.zoom).toBeCloseTo(worldUnderPointer.y, 6);
  });

  it("is a no-op once a limit is reached, rather than drifting the view", () => {
    // Returning the same object matters: a wheel held down at max zoom must not
    // keep nudging the board sideways.
    const cam = { x: 100, y: 100, zoom: MAX_ZOOM };
    expect(zoomAt(cam, 2, { x: 10, y: 10 }, world, viewport)).toBe(cam);
  });
});

describe("fit", () => {
  it("finds a zoom that shows the whole world", () => {
    const z = fitZoom(world, viewport);
    expect(world.width * z).toBeLessThanOrEqual(viewport.width);
    expect(world.height * z).toBeLessThanOrEqual(viewport.height);
  });

  it("never magnifies a small board past its natural size", () => {
    expect(fitZoom({ width: 400, height: 300 }, viewport)).toBe(1);
  });

  it("produces a camera that is already clamped", () => {
    const cam = fitCamera(world, viewport);
    expect(cam).toEqual(clampCamera(cam, world, viewport));
  });
});

describe("cameraTransform", () => {
  it("scales then translates, so the offset is in scaled px", () => {
    expect(cameraTransform({ x: 120, y: 40, zoom: 0.5 })).toBe(
      "scale(0.5) translate(-120px, -40px)",
    );
  });
});
