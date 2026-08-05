import { SimEvent } from "@/sim/simulation";

// A single line in the game's activity log: a simulation event, stamped with a
// monotonic id and the sim time it happened, rendered to human-readable text.
export interface GameLogEntry {
  id: number;
  time: number; // sim seconds when the event fired
  kind: SimEvent["type"];
  trainId: string;
  text: string;
}

// Readable phrasing for why a train was held.
const BLOCK_REASON_TEXT: Record<string, string> = {
  "signal-hold": "held at red signal",
  reservation: "reserved path ahead",
  occupancy: "train ahead",
};

// Human-readable summary of a single simulation event.
function describe(e: SimEvent): string {
  switch (e.type) {
    case "reserved":
      return `reserved ${e.tiles.join(" ")}`;
    case "blocked": {
      const reason = BLOCK_REASON_TEXT[e.reason] ?? e.reason;
      const by = e.blockedBy ? ` by ${e.blockedBy}` : "";
      return `held at ${e.tileId} — ${reason}${by}`;
    }
    case "proceeding":
      return `proceeding from ${e.tileId}`;
    case "arrived":
      return e.matched
        ? `delivered at ${e.tileId} ✓`
        : `bounced off ${e.tileId}`;
    case "dwell": {
      // "off" is arrivals only. Someone CHANGING here has not arrived anywhere
      // — they are back on the platform waiting for the service that finishes
      // the job — and reading it as an arrival is exactly the confusion the
      // separate count exists to prevent.
      const changing = e.changing ?? 0;
      const arrived = e.alighted - changing;
      const moves = [
        ...(arrived > 0 ? [`${arrived} off`] : []),
        ...(changing > 0 ? [`${changing} changing`] : []),
        ...(e.boarded > 0 ? [`${e.boarded} on`] : []),
      ];
      return `calling at ${e.tileId}${moves.length ? ` (${moves.join(", ")})` : ""}`;
    }
    case "departed":
      return `departed ${e.tileId}`;
    case "retired":
      return `stabled at ${e.tileId} — out of service`;
  }
}

// Build a log entry for a simulation event, stamped with a monotonic id and the
// sim time it occurred.
export function toLogEntry(
  e: SimEvent,
  id: number,
  time: number
): GameLogEntry {
  return { id, time, kind: e.type, trainId: e.trainId, text: describe(e) };
}
