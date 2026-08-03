import { Level } from "@/tiles/model";

// What to CALL a station. A line is a list of places — "Nordstadt, Hafen" —
// not a list of coordinates, and the moment a player has to read "2,1" to know
// which platform a stop is, the panel has stopped being a timetable.
//
// A board may name its platforms (`TileCell.stationName`). One that does not —
// every board written before names existed, and every quick test map — gets a
// stable LETTER derived from position, so there is always something short to
// print and it never moves about as the level is edited elsewhere.

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Reading order (top row first, then left to right) so the letters run the way
// the eye does over the board.
function stationOrder(level: Level): string[] {
  return Object.keys(level)
    .filter(id => level[id]?.role === "station")
    .sort((a, b) => {
      const [ax, ay] = a.split(",").map(Number);
      const [bx, by] = b.split(",").map(Number);
      return ay - by || ax - bx;
    });
}

// The display name of one station.
export function stationName(level: Level, tileId: string): string {
  const authored = level[tileId]?.stationName;
  if (authored) return authored;
  const at = stationOrder(level).indexOf(tileId);
  if (at < 0) return tileId;
  // Past Z (a 27-station board) the letter doubles up rather than running out.
  return at < 26
    ? LETTERS[at]
    : `${LETTERS[Math.floor(at / 26) - 1]}${LETTERS[at % 26]}`;
}

// Every station's name at once — what the view wants, and computed in ONE pass
// rather than re-sorting the board per station.
export function stationNames(level: Level): Record<string, string> {
  const order = stationOrder(level);
  const out: Record<string, string> = {};
  order.forEach((id, at) => {
    out[id] =
      level[id]?.stationName ??
      (at < 26
        ? LETTERS[at]
        : `${LETTERS[Math.floor(at / 26) - 1]}${LETTERS[at % 26]}`);
  });
  return out;
}
