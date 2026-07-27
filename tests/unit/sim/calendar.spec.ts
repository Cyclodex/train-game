import { describe, it, expect } from "vitest";
import {
  CalendarSetup,
  calendarAt,
  leviesDue,
  levyYear,
  taxFor,
  MONTH_NAMES,
} from "@/sim/calendar";

// The second clock, headless. Everything here is pure arithmetic over the
// scored elapsed time — which is the point: a hidden browser pane runs no
// requestAnimationFrame, so the frame loop is the one place this logic must NOT
// live if it is to be verifiable (KNOWHOW → VERIFY).

const spec: CalendarSetup = {
  startYear: 1830,
  secPerYear: 20,
  taxPerTrackPiecePerYear: 200,
};

describe("calendarAt", () => {
  it("opens on 1 January of the level's starting year", () => {
    expect(calendarAt(spec, 0)).toEqual({
      year: 1830,
      month: 0,
      label: "Jan 1830",
    });
  });

  it("walks the months across one year and rolls into the next", () => {
    const month = spec.secPerYear / 12;
    // Each twelfth of a year is the next month, in order.
    for (let m = 0; m < 12; m++) {
      const at = calendarAt(spec, m * month + month / 2);
      expect(at.year).toBe(1830);
      expect(at.month).toBe(m);
      expect(at.label).toBe(`${MONTH_NAMES[m]} 1830`);
    }
    // The year boundary itself is January of the NEXT year, never a 13th month.
    expect(calendarAt(spec, spec.secPerYear).label).toBe("Jan 1831");
    expect(calendarAt(spec, spec.secPerYear * 2.5).label).toBe("Jul 1832");
  });

  it("never indexes past December, whatever the float does", () => {
    // A float a hair under the boundary must still be December, not month 12.
    const at = calendarAt(spec, spec.secPerYear - 1e-12);
    expect(at.month).toBeLessThanOrEqual(11);
    expect(MONTH_NAMES[at.month]).toBeDefined();
  });

  it("degrades to a still clock rather than dividing by zero", () => {
    const broken = { ...spec, secPerYear: 0 };
    expect(calendarAt(broken, 999).label).toBe("Jan 1830");
    expect(leviesDue(broken, 999)).toBe(0);
  });

  it("treats a negative clock as the opening date", () => {
    expect(calendarAt(spec, -5).label).toBe("Jan 1830");
  });
});

describe("leviesDue", () => {
  it("charges nothing until the first year is over", () => {
    // The level opens tax-free. A run shorter than one in-game year pays
    // nothing — otherwise a small board would look like it was taking money
    // for no reason in its first seconds.
    expect(leviesDue(spec, 0)).toBe(0);
    expect(leviesDue(spec, spec.secPerYear - 0.01)).toBe(0);
  });

  it("adds one levy per completed year", () => {
    expect(leviesDue(spec, spec.secPerYear)).toBe(1);
    expect(leviesDue(spec, spec.secPerYear * 3.9)).toBe(3);
    expect(leviesDue(spec, spec.secPerYear * 4)).toBe(4);
  });

  it("names the year each levy closes the books on", () => {
    expect(levyYear(spec, 1)).toBe(1830);
    expect(levyYear(spec, 3)).toBe(1832);
  });
});

describe("taxFor", () => {
  it("scales with the track the player laid, and is zero with none", () => {
    // Only player-laid track is taxed, which is what makes the levy a decision
    // rather than a constant — and what lets a dispatch-only board pay nothing
    // without a special case.
    expect(taxFor(spec, 0)).toBe(0);
    expect(taxFor(spec, 7)).toBe(1400);
    expect(taxFor(spec, 6)).toBe(1200);
  });

  it("never returns a negative or fractional levy", () => {
    expect(taxFor(spec, -3)).toBe(0);
    expect(taxFor({ ...spec, taxPerTrackPiecePerYear: 33.3 }, 3)).toBe(100);
  });
});
