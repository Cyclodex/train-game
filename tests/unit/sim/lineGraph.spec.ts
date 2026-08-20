import { describe, it, expect } from "vitest";
import { buildLineGraph } from "@/sim/lineGraph";

// The question this graph answers is NOT "can a train get there" (that is
// railRouter, over the metals) but "can a PASSENGER get there on the services
// that exist" — and if so, where do they change.
//
//   Line A: N — C — S      (north/south through the middle)
//   Line B: C — E          (east, from the middle only)
//   Line C: W — X          (its own island, connected to nothing)
const N = "n";
const C = "c";
const S = "s";
const E = "e";
const W = "w";
const X = "x";

const network = () => [
  { id: "A", stops: [N, C, S] },
  { id: "B", stops: [C, E] },
  { id: "C", stops: [W, X] },
];

describe("the line graph", () => {
  it("counts a direct service as one ride and a change as two", () => {
    const g = buildLineGraph(network());
    expect(g.hops(N, S)).toBe(1); // both on line A
    expect(g.hops(N, E)).toBe(2); // A to C, change, B to E
    expect(g.hops(N, N)).toBe(0);
  });

  it("does not connect what no chain of services connects", () => {
    const g = buildLineGraph(network());
    expect(g.hops(N, W)).toBeUndefined();
    expect(g.serves(N, W)).toBe(false);
    expect(g.serves(N, E)).toBe(true);
    // Nobody travels to the platform they are standing on.
    expect(g.serves(N, N)).toBe(false);
  });

  it("sets a rider down at their destination when the line goes there", () => {
    const g = buildLineGraph(network());
    // On A at N, bound for S: A calls at S, so no change — whatever else the
    // network offers.
    expect(g.alightFor("A", N, S)).toBe(S);
  });

  it("sets a rider down at the INTERCHANGE when it does not", () => {
    const g = buildLineGraph(network());
    // On A at N, bound for E: A never reaches E, but it calls at C, where B
    // does. So: change at C.
    expect(g.alightFor("A", N, E)).toBe(C);
    // And the second leg is then direct.
    expect(g.alightFor("B", C, E)).toBe(E);
  });

  it("says NO rather than a wrong hop when the line cannot help", () => {
    const g = buildLineGraph(network());
    // B is no use to someone at C bound for N — it goes the other way and
    // reaches nothing closer.
    expect(g.alightFor("B", C, N)).toBeUndefined();
    // Nor is a line the rider is not even standing on.
    expect(g.alightFor("A", E, S)).toBeUndefined();
    // Nor one that leads to an island.
    expect(g.alightFor("C", W, N)).toBeUndefined();
  });

  it("never hands a rider round a cycle for ever", () => {
    // A triangle of two-stop lines: every station is reachable and every line
    // is a possible next ride, which is exactly the shape that loops if a hop
    // is allowed to be merely "not worse".
    const g = buildLineGraph([
      { id: "A", stops: ["p", "q"] },
      { id: "B", stops: ["q", "r"] },
      { id: "C", stops: ["r", "p"] },
    ]);
    // From p, line C reaches r directly — one ride.
    expect(g.alightFor("C", "p", "r")).toBe("r");
    // So line A is REFUSED for that journey: riding it to q would still leave
    // one ride to go, having spent a ride and a change to get no closer. This
    // is the rule that keeps the triangle from becoming a merry-go-round.
    expect(g.alightFor("A", "p", "r")).toBeUndefined();
  });

  it("accepts the change when it genuinely gets closer", () => {
    // A chain rather than a triangle: from p, r is only reachable by changing.
    const g = buildLineGraph([
      { id: "A", stops: ["p", "q"] },
      { id: "B", stops: ["q", "r"] },
    ]);
    expect(g.alightFor("A", "p", "r")).toBe("q");
    expect(g.alightFor("B", "q", "r")).toBe("r");
  });

  it("ignores a line that calls at fewer than two stations", () => {
    const g = buildLineGraph([
      { id: "A", stops: [N] },
      { id: "B", stops: [] },
      { id: "C", stops: [N, S] },
    ]);
    expect(g.stations.sort()).toEqual([N, S].sort());
    expect(g.alightFor("A", N, S)).toBeUndefined();
    expect(g.hops(N, S)).toBe(1);
  });

  it("treats a line as a cycle, so direction never matters", () => {
    const g = buildLineGraph([{ id: "A", stops: [N, C, S] }]);
    // A train wraps past the last stop back to the first, so S is reachable
    // from N and N from S alike.
    expect(g.alightFor("A", S, N)).toBe(N);
    expect(g.alightFor("A", C, N)).toBe(N);
  });

  it("lists what a platform can actually reach", () => {
    const g = buildLineGraph(network());
    expect(g.reachableFrom(N).sort()).toEqual([C, E, S].sort());
    expect(g.reachableFrom(W)).toEqual([X]);
    // A station no line calls at reaches nothing at all.
    expect(g.reachableFrom("nowhere")).toEqual([]);
  });

  it("is empty when nothing has been drawn yet", () => {
    const g = buildLineGraph([]);
    expect(g.stations).toEqual([]);
    expect(g.serves(N, S)).toBe(false);
    expect(g.reachableFrom(N)).toEqual([]);
  });
});
