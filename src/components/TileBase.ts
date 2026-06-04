import { Component, Inject, Prop, Vue } from "vue-facing-decorator";
import { GameConfig, GAME_CONFIG_KEY } from "@/gameConfig";
import type { Game } from "@/game";
import {
  Position,
  PossibleRoutesPerRotation,
  Rotations,
  Route,
  TileObject,
  TileStatus,
} from "@/types";
import { getCoordinatesId } from "@/utils/tileHelpers";

// Shared base class for every tile component. It is never registered or
// rendered on its own (each concrete tile provides its own <template>), so it
// lives as a plain `.ts` class: a Vue SFC default export gets wrapped into a
// component options object, which cannot be used as the target of `extends`.
//
// Tiles are pure views: they draw rails/rotation/switches/signals and publish
// their live state into the game. Movement is owned by the simulation
// (src/sim) and the render loop (src/game.ts), not by the tiles.
@Component
export default class TileBase extends Vue {
  @Inject({ from: GAME_CONFIG_KEY }) config!: GameConfig;
  @Inject({ from: "game" }) game!: Game;

  @Prop({ type: Object, default: () => ({}) }) tile!: TileObject;
  tileSize!: number;
  currentRotation: Rotations = Rotations.Top;
  possibleRoutes!: PossibleRoutesPerRotation;
  status: TileStatus = TileStatus.Free;

  created() {
    this.tileSize = this.config.tileSize;
    if (this.tile.rotation) {
      this.currentRotation = this.tile.rotation;
    }
  }

  get tileStatusStyle() {
    if (!this.config.debug) return "";
    switch (this.status) {
      case TileStatus.Free:
        return "tile-status--free";
      case TileStatus.Reserved:
        return "tile-status--reserved";
      case TileStatus.Blocked:
        return "tile-status--blocked";
      default:
        return "";
    }
  }

  // Simulation-backed signals (block boundaries). Only signal tiles render them.
  get isSignalTile(): boolean {
    return !!this.tile.trafficLights;
  }

  signalAspectFor(exitPort: Position): "stop" | "proceed" {
    return (
      this.game.signalAspects[`${getCoordinatesId(this.tile)}:${exitPort}`] ??
      "proceed"
    );
  }

  toggleSignalHold(exitPort: Position) {
    this.game.toggleHold(getCoordinatesId(this.tile), exitPort);
  }

  get allPossibleRoutesWithCurrentRotation() {
    return this.possibleRoutes[this.currentRotation];
  }

  get allDrawableRailRoutes(): Route[] | undefined {
    // Take the same rotation as position
    const route =
      this.possibleRoutes[this.currentRotation][this.currentRotation] ??
      undefined;
    return route ? Array(route) : [];
  }

  getCoordinates(
    simplePath: string,
    xChange: "-" | "+" | string = "",
    yChange: "-" | "+" | string = ""
  ) {
    const center = this.tileSize / 2;
    const full = this.tileSize;
    const distance = this.config.railDistanceFromPath;
    const centerX = Number(xChange + this.config.railDistanceFromPath);
    const centerY = Number(yChange + this.config.railDistanceFromPath);

    let coordinates;
    coordinates = simplePath.replaceAll("T-", `${center - distance} 0`);
    coordinates = coordinates.replaceAll("T+", `${center + distance} 0`);
    coordinates = coordinates.replaceAll("T", `${center} 0`);
    coordinates = coordinates.replaceAll("R-", `${full} ${center - distance}`);
    coordinates = coordinates.replaceAll("R+", `${full} ${center + distance}`);
    coordinates = coordinates.replaceAll("R", `${full} ${center}`);
    coordinates = coordinates.replaceAll("B-", `${center - distance} ${full}`);
    coordinates = coordinates.replaceAll("B+", `${center + distance} ${full}`);
    coordinates = coordinates.replaceAll("B", `${center} ${full}`);
    coordinates = coordinates.replaceAll("L-", `0 ${center - distance}`);
    coordinates = coordinates.replaceAll("L+", `0 ${center + distance}`);
    coordinates = coordinates.replaceAll("L", `0 ${center}`);
    coordinates = coordinates.replaceAll("CX-", `${center - distance}`);
    coordinates = coordinates.replaceAll("CX+", `${center + distance}`);
    coordinates = coordinates.replaceAll("CX", `${center + centerX}`);
    coordinates = coordinates.replaceAll("CY-", `${center - distance}`);
    coordinates = coordinates.replaceAll("CY+", `${center + distance}`);
    coordinates = coordinates.replaceAll("CY", `${center + centerY}`);
    coordinates = coordinates.replaceAll("C", `${center} ${center}`);
    return coordinates;
  }

  // Curve always through the center of the tile
  getPathCurve(from: "T" | "R" | "B" | "L", to: "T" | "R" | "B" | "L") {
    return this.getCoordinates(`M ${from} Q C ${to}`);
  }
  getPathStraight(
    from: "T" | "R" | "B" | "L" | "C",
    to: "T" | "R" | "B" | "L" | "C"
  ) {
    return this.getCoordinates(`M ${from} ${to}`);
  }

  // Rails are neg or pos off from the path, with special handling for the center
  getRailCurve(
    from: "T-" | "T+" | "R-" | "R+" | "B-" | "B+" | "L-" | "L+",
    to: "T-" | "T+" | "R-" | "R+" | "B-" | "B+" | "L-" | "L+"
  ) {
    let xChange, yChange;
    const fromLocation = from.substring(0, 1);
    const fromChange = from.substring(1);
    const toChange = to.substring(1);
    if (fromLocation === "T" || fromLocation === "B") {
      // from is X modifiers
      xChange = fromChange;
      yChange = toChange;
    } else {
      // from is Y modifiers
      xChange = toChange;
      yChange = fromChange;
    }
    return this.getCoordinates(`M ${from} Q CX CY ${to}`, xChange, yChange);
  }

  getRailStraight(
    from: "T-" | "T+" | "R-" | "R+" | "B-" | "B+" | "L-" | "L+" | string,
    to: "T-" | "T+" | "R-" | "R+" | "B-" | "B+" | "L-" | "L+" | string
  ) {
    return this.getCoordinates(`M ${from} ${to}`);
  }
}
