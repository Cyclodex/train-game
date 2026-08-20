// THE LINE GRAPH — can a PASSENGER get there on the services that exist?
//
// `railRouter.ts` answers a different question: can a TRAIN physically get
// there over the metals. That is the right question for a vehicle and the wrong
// one for a person, who can only travel where a service actually runs, and who
// may have to change trains to do it.
//
// So: nodes are stations, and two stations are adjacent when some line calls at
// both. A shortest path over that graph is a journey, and every node on it
// where the line changes is a transfer.
//
// The graph is derived, never stored on a passenger. See D7 in the design doc:
// the hop a rider takes is decided when they BOARD, from the graph as it is at
// that moment, so a player who redraws a line mid-journey cannot strand anyone
// holding a stale plan.

export interface LineStops {
  id: string;
  stops: string[];
}

export interface LineGraph {
  // Every station any line calls at, in a stable order.
  stations: string[];
  // How many changes a journey takes, or undefined when no chain of services
  // connects the two. `hops(a, a)` is 0.
  hops(from: string, to: string): number | undefined;
  // Riding THIS line from `at`, where should someone bound for `to` get off?
  // The stop on the line that leaves them closest to their destination —
  // `to` itself when the line calls there, an interchange when it does not,
  // and undefined when this line is no use to them at all.
  //
  // A line is a CYCLE (a train wraps past the last stop to the first), so every
  // stop on it is reachable from every other and the direction never matters
  // here — only which stops it touches.
  alightFor(lineId: string, at: string, to: string): string | undefined;
  // Is `to` reachable from `at` by any chain of services? The spawn gate (D10):
  // nobody walks to a station that cannot take them where they are going.
  serves(at: string, to: string): boolean;
  // The stations reachable from `at` by some chain of services, in a stable
  // order — what a platform's demand may draw from.
  reachableFrom(at: string): string[];
}

// Build the graph from the lines as they are RIGHT NOW. Cheap enough to rebuild
// whenever a line changes (a player action, not a per-tick event); the caller
// memoises it behind a version counter.
export function buildLineGraph(lines: LineStops[]): LineGraph {
  // station -> the lines calling there; line -> its stops as a set.
  const linesAt = new Map<string, string[]>();
  const stopsOfLine = new Map<string, string[]>();
  const stations: string[] = [];
  for (const line of lines) {
    // A line has to call at TWO stations before it carries anyone anywhere.
    const unique = [...new Set(line.stops)];
    stopsOfLine.set(line.id, unique);
    if (unique.length < 2) continue;
    for (const stop of unique) {
      if (!linesAt.has(stop)) {
        linesAt.set(stop, []);
        stations.push(stop);
      }
      linesAt.get(stop)?.push(line.id);
    }
  }

  // Breadth-first over stations, hopping along whole lines: from a station you
  // reach every stop of every line calling there in ONE ride. So the BFS depth
  // is the number of RIDES, and depth - 1 is the number of changes.
  //
  // Computed once per origin and cached — a board has a handful of stations, and
  // the same origin is asked about on every boarding.
  const distCache = new Map<string, Map<string, number>>();
  function distancesFrom(from: string): Map<string, number> {
    const cached = distCache.get(from);
    if (cached) return cached;
    const dist = new Map<string, number>([[from, 0]]);
    let frontier = [from];
    while (frontier.length) {
      const next: string[] = [];
      for (const at of frontier) {
        const d = dist.get(at) ?? 0;
        for (const lineId of linesAt.get(at) ?? []) {
          for (const stop of stopsOfLine.get(lineId) ?? []) {
            if (dist.has(stop)) continue;
            dist.set(stop, d + 1);
            next.push(stop);
          }
        }
      }
      frontier = next;
    }
    distCache.set(from, dist);
    return dist;
  }

  return {
    stations: [...stations],
    hops(from: string, to: string) {
      if (from === to) return 0;
      return distancesFrom(from).get(to);
    },
    alightFor(lineId: string, at: string, to: string) {
      const stops = stopsOfLine.get(lineId);
      if (!stops?.length) return undefined;
      if (!stops.includes(at)) return undefined;
      // The obvious case: this line goes there. No change, whatever some other
      // route might do in fewer nominal hops.
      if (stops.includes(to)) return to;
      // Otherwise get off wherever this line leaves the shortest onward
      // journey. STRICTLY closer than staying put, or a rider could be handed
      // round a triangle for ever (trap 1 in the design doc).
      const here = distancesFrom(at).get(to);
      if (here === undefined) return undefined;
      let best: string | undefined;
      let bestDist = here;
      for (const stop of stops) {
        if (stop === at) continue;
        const d = distancesFrom(stop).get(to);
        if (d === undefined || d >= bestDist) continue;
        bestDist = d;
        best = stop;
      }
      return best;
    },
    serves(at: string, to: string) {
      if (at === to) return false;
      return distancesFrom(at).has(to);
    },
    reachableFrom(at: string) {
      const dist = distancesFrom(at);
      return stations.filter(s => s !== at && dist.has(s));
    },
  };
}
