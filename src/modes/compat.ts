import { Level } from "@/tiles/model";
import { plotsOf } from "@/tiles/cities";
import { busStopTiles } from "@/tiles/catchment";
import { TrainDef } from "@/modes/types";

// Board↔mode compatibility (#114).
//
// A mode declares what a board must OFFER (GameMode.fits), and a board's
// capabilities are DERIVED from its tiles and roster — so authors never
// maintain per-board mode lists, and a board built in the editor is judged
// exactly like an authored scenario. Boards stay multi-mode: this filters the
// picker and guards the URL, it never pins a board to one mode.
export interface BoardCapabilities {
  trains: number; // roster size (init + scheduled)
  stations: number; // role === "station" tiles
  depots: number; // role === "depot" tiles — where a service train can be ordered
  busStops: number; // bus-stop kerbs — a passenger carrier that isn't a train
  homes: number; // citizen plots people live on
  workplaces: number; // citizen plots people travel to (work/shop/school/leisure)
}

export function boardCapabilities(
  level: Level,
  trains: TrainDef[]
): BoardCapabilities {
  let stations = 0;
  let depots = 0;
  for (const cell of Object.values(level)) {
    if (cell.role === "station") stations += 1;
    else if (cell.role === "depot") depots += 1;
  }
  let homes = 0;
  let workplaces = 0;
  for (const plot of plotsOf(level)) {
    if (plot.kind === "home") homes += 1;
    else workplaces += 1;
  }
  return {
    trains: trains.length,
    stations,
    depots,
    busStops: busStopTiles(level).length,
    homes,
    workplaces,
  };
}
