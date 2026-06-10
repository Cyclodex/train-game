import { Position, ActiveIntersection } from "@/types";
import {
  Port,
  PortPair,
  TileCell,
  portsOf,
  rotateConnections,
  samePair,
} from "@/tiles/model";

const { Top, Right, Bottom, Left, Center } = Position;

// Base connections at rotation 0 for each authoring kind.
const ALL_CROSS: PortPair[] = [
  [Top, Bottom],
  [Left, Right],
  [Top, Right],
  [Right, Bottom],
  [Bottom, Left],
  [Left, Top],
];

const BASE: Record<string, PortPair[]> = {
  straight: [[Top, Bottom]],
  curve: [[Top, Right]],
  depot: [[Top, Center]],
  cross: ALL_CROSS,
  // A T-junction at rot 0 has the trunk along Left-Right with a branch to Top.
  tjunction: [
    [Left, Right],
    [Left, Top],
    [Right, Top],
  ],
};

export type AuthorKind = keyof typeof BASE;

export interface KindOptions {
  // `true` puts a signal on every (non-Center) exit port; or pass explicit ports.
  signals?: boolean | Port[];
  disable?: PortPair[]; // pairs (at the final rotation) to remove
  // Authored starting switch arms, keyed by the FINAL (post-rotation) entry port.
  // Copied onto the cell's `defaultArms`; ignored when empty. The read-time guard
  // (`defaultArmFor`) drops any arm whose exit isn't a real connection.
  defaultArms?: Partial<Record<Port, ActiveIntersection>>;
}

// Expand a friendly kind + rotation into a canonical TileCell. `rotation` is in
// quarter-turns clockwise (0..3). `disable` pairs are matched after rotation.
export function expandKind(
  kind: AuthorKind,
  rotation = 0,
  opts: KindOptions = {}
): TileCell {
  const base = BASE[kind];
  if (!base) throw new Error(`Unknown tile kind: ${kind}`);
  let connections = rotateConnections(base, rotation);
  if (opts.disable?.length) {
    connections = connections.filter(
      c => !opts.disable!.some(d => samePair(c, d))
    );
  }
  const cell: TileCell = { connections };
  if (kind === "depot") cell.role = "depot";
  if (opts.signals === true) {
    cell.signals = portsOf(connections).filter(p => p !== Center);
  } else if (Array.isArray(opts.signals)) {
    cell.signals = opts.signals;
  }
  if (opts.defaultArms && Object.keys(opts.defaultArms).length > 0) {
    cell.defaultArms = { ...opts.defaultArms };
  }
  return cell;
}
