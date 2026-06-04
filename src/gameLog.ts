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
