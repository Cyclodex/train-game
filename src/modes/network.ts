import {
  GameMode,
  ModeContext,
  ModeSetup,
  objectiveFromSpec,
} from "@/modes/types";
import { Counters, StarSpec } from "@/sim/objectives";
import { Level } from "@/tiles/model";

// How full a platform may get before the level is lost. The Mini-Metro
// pressure in station form: the crowd is the clock, and a line that cannot
// keep up shows it here long before anything else goes wrong.
export const OVERCROWD_LIMIT = 12;

// Passengers asked for, per station on the board. A board with more stations
// generates more demand, so the target scales with it rather than being a flat
// number that is trivial on a busy map and impossible on a quiet one.
export const PASSENGERS_PER_STATION = 12;

export function stationCount(level: Level): number {
  return Object.values(level).filter(c => c.role === "station").length;
}

// The target this board asks for: at least one station's worth, so a
// single-platform test map is still a real objective.
export function passengerTargetOf(level: Level): number {
  return Math.max(PASSENGERS_PER_STATION, stationCount(level) * PASSENGERS_PER_STATION);
}

// A brisk run, in seconds: the target divided by roughly what one well-driven
// shuttle turns over per second, with slack for the crowd having to build in
// the first place. Scales with the board's target rather than being a flat
// number that is free on a small map and impossible on a big one.
export function briskSecondsFor(target: number): number {
  return target * 4;
}

function networkStars(target: number, calmQueue: number): StarSpec[] {
  const briskSec = briskSecondsFor(target);
  return [
    {
      id: "full-service",
      label: `Full service (${target * 2})`,
      hint: "Carry twice the passengers asked for",
      predicate: (c: Counters) => (c.passengersDelivered ?? 0) >= target * 2,
    },
    {
      // The crowd is the score: keeping platforms short means the service is
      // frequent enough, which is the whole skill of the mode.
      id: "no-crowding",
      label: `Never crowded (max ${calmQueue})`,
      hint: "Never let a platform hold more than that many people",
      predicate: (c: Counters) => (c.peakStationQueue ?? 0) <= calmQueue,
    },
    {
      // NOT "never arrive at the wrong depot", which every other mode scores:
      // a network shuttle turns round by bouncing off a depot that isn't its
      // colour, so that star would punish the very thing the mode is built on.
      // Briskness is the honest equivalent — the same service, sooner.
      id: "brisk-service",
      label: `Brisk service (${briskSec}s)`,
      hint: "Carry everyone asked for inside the time",
      predicate: (c: Counters) =>
        (c.passengersDelivered ?? 0) >= target && c.elapsedSec <= briskSec,
    },
  ];
}

// NETWORK — the Transport-Fever-shaped mode: the board is a living passenger
// network rather than a puzzle with an end state. People appear at the
// stations (their rate derived from the town around each one — see
// tiles/catchment.ts), walk or drive or take a bus to the platform, and it is
// the player's job to keep the trains moving so the crowds never outgrow the
// service.
//
// What makes it a MODE rather than a board: the win is passengers CARRIED, not
// trains parked, and the failure is a platform overflowing. Deliveries are
// deliberately not required (`deliveriesRequired: 0`) — a train that keeps
// shuttling forever is a good service, not an unfinished level.
export const networkMode: GameMode = {
  id: "network",
  label: "Network",
  description:
    "Keep the passengers moving: people gather at the stations and it is your " +
    "railway that has to clear them, before a platform overflows.",
  setup(ctx: ModeContext): ModeSetup {
    const target = passengerTargetOf(ctx.level);
    return {
      levelId: ctx.levelId,
      level: ctx.level,
      trains: ctx.trains,
      objective: {
        // No train-delivery requirement: this mode is scored in people.
        deliveriesRequired: 0,
        passengersRequired: target,
        initialActiveTrains: ctx.trains.length,
        fail: { maxStationQueue: OVERCROWD_LIMIT },
        stars: networkStars(target, Math.max(2, Math.floor(OVERCROWD_LIMIT / 2))),
      },
    };
  },
  controls: {
    switches: true,
    signalHolds: true,
    crossingGate: false,
    build: false,
    dispatch: false,
  },
  createObjective: objectiveFromSpec,
  hud: {
    // The passenger card replaces the delivery card here: what the player is
    // steering is people carried, and showing both would be the HUD density
    // the Tycoon design doc §5.5 warns against.
    deliveries: false,
    passengers: true,
    timer: true,
    stars: true,
    startOverlay: true,
    endOverlay: true,
    money: false,
  },
};
