// Procedural station architecture: the building a platform is a STATION
// because of, drawn as SVG in the same language as the depot shed
// (`utils/trainArt.ts`) and the town roofs (`tiles/terrain.ts`) — flat fills
// with a lit/shade split, sun from the north-west, a drop shadow to the
// south-east, no gradients.
//
// Why a building at all: before this the whole station was two beige slabs in
// the grass and an 18px shield. The depot — the OTHER end of a journey — has had
// a drawn shed since the sprites went procedural, so a platform read as the
// lesser place on the board, which is backwards: in network mode the station is
// where the game happens and the depot is only where the train came from.
//
// Two sizes, picked from the walking catchment (`tiles/catchment.ts`), not from
// a field an author could set: a lonely halt in a meadow gets a shelter, a
// platform with a town round it gets an Empfangsgebäude. Same rule as the fares
// and the demand schedule — the map is the single source of truth, so painting
// houses next to a halt promotes it and nobody can author a metropolis terminus
// into an empty field.
//
// SIMPLICITY IS THE WHOLE TRICK at this scale. The first cut had hipped roofs,
// a taller concourse block, roof lights and two chimneys inside 124x46 px, and
// it read as three blue boxes in a row rather than as one building. What works
// is what the town houses do: one body, one gabled roof split lit/shade, a hard
// drop shadow, one or two chimneys — and then the ONE thing that says railway
// rather than house, a glazed canopy on posts reaching out over the platform.
//
// Local coordinate frame for both: x runs ALONG the platform, y runs AWAY from
// the track — y=0 is the street side, y=depth is the platform side. `Tile.vue`
// places and rotates that frame onto the tile's outer strip.

const n = (v: number) => v.toFixed(1);

// Slate-blue roofs and cream walls: civic rather than industrial, so a station
// reads as a different KIND of building from the depot's grey shed at a glance,
// and never as one of the town's red-tiled houses. Saturated and DARK enough to
// carry against the pale platform slab — the washed-out first pass disappeared
// into it.
const ROOF_LIT = "#8299bd"; // the north-west slope, in the sun
const ROOF_SHADE = "#465e85"; // the south-east slope
const RIDGE = "#2b3a52";
const WALL = "#f2ece0";
const WALL_SHADE = "#a89d8a";
const DOOR = "#3a4152";
// The glazed platform roof. Nearly colourless on purpose: the first cut had it
// the same blue as the tiles, and house + canopy then read as ONE blue slab
// rather than a building with a roof over the platform. What makes it a glass
// roof is the RAFTERS and the posts, not the tint — and being this thin is what
// lets the waiting crowd underneath still show through it.
const CANOPY = "rgba(233, 241, 249, 0.42)";
const CANOPY_RAFTER = "rgba(43, 58, 82, 0.45)";
const CANOPY_EDGE = "#1c5bd8"; // railway blue: the one accent, on the eaves
const POST = "#3d4756";
const SHADOW = "rgba(0, 0, 0, 0.26)";
const LAMP = "#ffe9a8";

/** How much building a platform has earned. */
export type StationSize = "halt" | "station";

// The art's own box, in the local frame described above — authored at the
// numbers a 200px tile wants, so at the default tile size one art unit is one
// CSS pixel and the drawing needs no mental scaling. `Tile.vue` sizes its <svg>
// to the same fractions, so the two must move together.
//
// The depth deliberately runs PAST the platform's inner edge: the canopy is
// over the platform in real life, and the version that stopped politely short
// of the slab read as a bench rather than as a station. `houseDepth` is where
// the building stops and the canopy takes over.
export const STATION_ART_BOX: Record<
  StationSize,
  { w: number; d: number; houseDepth: number }
> = {
  halt: { w: 80, d: 38, houseDepth: 17 },
  station: { w: 150, d: 46, houseDepth: 30 },
};

export const stationViewBox = (size: StationSize): string =>
  `0 0 ${STATION_ART_BOX[size].w} ${STATION_ART_BOX[size].d}`;

// A town within walking reach turns a halt into a station. Three tiles is the
// threshold because that is also where `stationDemandOf` starts producing a
// passenger faster than every 8s — the point at which the platform needs a
// building to be believable, not just a bench.
export const STATION_URBAN_THRESHOLD = 3;

export function stationSizeFor(urbanTiles: number): StationSize {
  return urbanTiles >= STATION_URBAN_THRESHOLD ? "station" : "halt";
}

/**
 * A gabled roof over the rectangle (x0,y0)-(x1,y1), its ridge running along x:
 * the north-west slope lit, the south-east slope in shade, a bright ridge line
 * between them. Exactly the read `pitched()` gives the town houses, which is
 * why a station drawn this way sits in the same world as they do.
 */
function gabledRoof(x0: number, y0: number, x1: number, y1: number): string {
  const ry = (y0 + y1) / 2;
  return (
    `<rect x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(ry - y0)}" fill="${ROOF_LIT}"/>` +
    `<rect x="${n(x0)}" y="${n(ry)}" width="${n(x1 - x0)}" height="${n(y1 - ry)}" fill="${ROOF_SHADE}"/>` +
    `<rect x="${n(x0)}" y="${n(ry - 0.8)}" width="${n(x1 - x0)}" height="1.6" fill="${RIDGE}"/>`
  );
}

/** A chimney stack sitting ON the ridge, same idea as the town's. */
function chimney(x: number, ridgeY: number): string {
  return `<rect x="${n(x - 2.6)}" y="${n(ridgeY - 2.6)}" width="5.2" height="5.2" rx="0.7" fill="${RIDGE}"/>`;
}

/**
 * The glazed roof over the platform: a thin translucent slab reaching from the
 * building out across the slab, ribbed with rafters that each land on a post at
 * the platform edge, and finished with a blue leading edge. This is the part
 * that reads as "railway" from three tiles away — a roof alone could be any
 * shed — and it is drawn last so the people waiting underneath show through it.
 */
function canopy(x0: number, y0: number, x1: number, y1: number, bays: number): string {
  const w = x1 - x0;
  let out = `<rect x="${n(x0)}" y="${n(y0)}" width="${n(w)}" height="${n(y1 - y0)}" rx="1.2" fill="${CANOPY}"/>`;
  for (let i = 0; i <= bays; i++) {
    const px = x0 + (i / bays) * w;
    const cx = Math.min(Math.max(px, x0 + 1.4), x1 - 1.4);
    out +=
      `<rect x="${n(cx - 0.5)}" y="${n(y0)}" width="1" height="${n(y1 - y0)}" fill="${CANOPY_RAFTER}"/>` +
      `<rect x="${n(cx - 1.4)}" y="${n(y1 - 4.2)}" width="2.8" height="4.2" rx="0.7" fill="${POST}"/>`;
  }
  return (
    out +
    `<rect x="${n(x0)}" y="${n(y1 - 1.8)}" width="${n(w)}" height="1.8" rx="0.9" fill="${CANOPY_EDGE}"/>`
  );
}

/**
 * The Empfangsgebäude: one long gabled body along the back of the platform,
 * chimneys on the ridge, the booking-hall doors facing the track, and the
 * canopy reaching out over where the passengers stand.
 */
function stationHouseSvg(): string {
  const { w, d, houseDepth } = STATION_ART_BOX.station;
  const e = 4;
  const top = 3;
  const ridgeY = (top + houseDepth) / 2;
  return (
    // Ground shadow first, offset south-east like every other building's.
    `<rect x="${n(e + 3)}" y="${n(top + 3)}" width="${n(w - 2 * e)}" height="${n(houseDepth - top)}" rx="2" fill="${SHADOW}"/>` +
    // Walls, showing as a rim below the roof overhang.
    `<rect x="${n(e - 2.4)}" y="${n(top - 2)}" width="${n(w - 2 * e + 4.8)}" height="${n(houseDepth - top + 4)}" rx="2" fill="${WALL_SHADE}"/>` +
    `<rect x="${n(e - 1.2)}" y="${n(top - 0.8)}" width="${n(w - 2 * e + 2.4)}" height="${n(houseDepth - top + 1.6)}" rx="1.5" fill="${WALL}"/>` +
    gabledRoof(e, top, w - e, houseDepth) +
    chimney(w * 0.22, ridgeY) +
    chimney(w * 0.78, ridgeY) +
    // The booking hall's doors, in the trackside wall under the canopy: the one
    // dark note on the building, and what tells you which side people come out.
    `<rect x="${n(w / 2 - 11)}" y="${n(houseDepth - 1.4)}" width="22" height="4" rx="1" fill="${DOOR}"/>` +
    canopy(e - 4, houseDepth + 1.6, w - e + 4, d - 1, 7) +
    // Platform lamps, at the canopy's ends.
    `<circle cx="${n(e - 1.5)}" cy="${n(d - 7)}" r="2" fill="${LAMP}"/>` +
    `<circle cx="${n(w - e + 1.5)}" cy="${n(d - 7)}" r="2" fill="${LAMP}"/>`
  );
}

/**
 * The halt: no building to speak of, just a shelter — a back wall under a small
 * gabled roof, a bench, and the same glazed canopy and blue eaves the big one
 * has, so the two read as the same railway at different sizes.
 */
function haltShelterSvg(): string {
  const { w, d, houseDepth } = STATION_ART_BOX.halt;
  const e = 4;
  const top = 2.5;
  return (
    `<rect x="${n(e + 2.4)}" y="${n(top + 2.4)}" width="${n(w - 2 * e)}" height="${n(houseDepth - top)}" rx="1.5" fill="${SHADOW}"/>` +
    // The one closed side, at the back where the weather comes from.
    `<rect x="${n(e - 2)}" y="${n(top - 1.6)}" width="${n(w - 2 * e + 4)}" height="${n(houseDepth - top + 3.2)}" rx="1.5" fill="${WALL_SHADE}"/>` +
    `<rect x="${n(e - 1)}" y="${n(top - 0.6)}" width="${n(w - 2 * e + 2)}" height="${n(houseDepth - top + 1.2)}" rx="1.2" fill="${WALL}"/>` +
    gabledRoof(e, top, w - e, houseDepth) +
    // A bench, drawn BEFORE the canopy so it shows through the glazing — the
    // detail that makes a shelter a place to wait rather than a lid on a post.
    `<rect x="${n(w * 0.3)}" y="${n(houseDepth + 3)}" width="${n(w * 0.4)}" height="2.6" rx="1.1" fill="${WALL_SHADE}"/>` +
    canopy(e - 3, houseDepth + 1.2, w - e + 3, d - 1, 4) +
    `<circle cx="${n(w / 2)}" cy="${n(d - 7)}" r="1.9" fill="${LAMP}"/>`
  );
}

/** The art for a station of the given size. Pure — same input, same markup. */
export function stationBuildingSvg(size: StationSize): string {
  return size === "station" ? stationHouseSvg() : haltShelterSvg();
}
