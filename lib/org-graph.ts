/** Org chart graph: space topology fetched from the server, plus a deterministic layout. */

export type OrgNodeStatus = "running" | "stopped";
export type OrgEdgeType = "group" | "message";

export interface OrgNode {
  id: string;
  name: string;
  description: string;
  spaceId: string;
  status: OrgNodeStatus;
}

export interface OrgEdge {
  type: OrgEdgeType;
  a: string;
  b: string;
}

export interface OrgGraph {
  nodes: OrgNode[];
  edges: OrgEdge[];
}

export interface Point {
  x: number;
  y: number;
}

export interface OrgLayout {
  positions: Record<string, Point>;
  width: number;
  height: number;
}

export const NODE_WIDTH = 112;
export const NODE_HEIGHT = 56;
export const NODE_GAP = 120;
export const MIN_RING_RADIUS = 80;
export const MAX_RING_RADIUS = 340;
export const COMPONENT_GAP = 120;
export const CANVAS_PADDING = 48;

export const graphPath = (spaceId: string) => `/api/spaces/${encodeURIComponent(spaceId)}/graph`;

/** Ring radius for a component: enough circumference for the nodes, clamped to keep it legible. */
export function ringRadius(count: number): number {
  if (count <= 1) return 0;
  return Math.min(MAX_RING_RADIUS, Math.max(MIN_RING_RADIUS, (count * NODE_GAP) / (2 * Math.PI)));
}

/** Tolerant parse: unknown or malformed rows are dropped rather than failing the whole view. */
export function parseGraph(value: unknown): OrgGraph {
  const input = value as { nodes?: unknown; edges?: unknown } | null;
  const nodes: OrgNode[] = [];
  const seen = new Set<string>();
  if (input && Array.isArray(input.nodes)) {
    for (const row of input.nodes) {
      const node = row as Partial<OrgNode> | null;
      if (!node || typeof node.id !== "string" || !node.id || typeof node.name !== "string" || seen.has(node.id)) continue;
      seen.add(node.id);
      nodes.push({
        id: node.id,
        name: node.name,
        description: typeof node.description === "string" ? node.description : "",
        spaceId: typeof node.spaceId === "string" ? node.spaceId : "",
        status: node.status === "running" ? "running" : "stopped",
      });
    }
  }
  const edges: OrgEdge[] = [];
  const known = new Set(nodes.map((node) => node.id));
  const seenEdges = new Set<string>();
  if (input && Array.isArray(input.edges)) {
    for (const row of input.edges) {
      const edge = row as Partial<OrgEdge> | null;
      if (!edge || (edge.type !== "group" && edge.type !== "message")) continue;
      if (typeof edge.a !== "string" || typeof edge.b !== "string") continue;
      if (edge.a === edge.b || !known.has(edge.a) || !known.has(edge.b)) continue;
      const key = `${edge.type}\u0000${edge.a}\u0000${edge.b}`;
      if (seenEdges.has(key)) continue;
      seenEdges.add(key);
      edges.push({ type: edge.type, a: edge.a, b: edge.b });
    }
  }
  return { nodes, edges };
}

/** One ring per connected component, components packed into a grid. Deterministic for a given graph. */
export function layoutGraph(graph: OrgGraph): OrgLayout {
  if (!graph.nodes.length) return { positions: {}, width: 0, height: 0 };
  const index = new Map<string, number>();
  graph.nodes.forEach((node, position) => index.set(node.id, position));
  const parent = graph.nodes.map((_, position) => position);
  const find = (start: number): number => {
    let current = start;
    while (parent[current] !== current) { parent[current] = parent[parent[current]!]!; current = parent[current]!; }
    return current;
  };
  const union = (left: number, right: number) => {
    const a = find(left), b = find(right);
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
  };
  for (const edge of graph.edges) {
    const a = index.get(edge.a), b = index.get(edge.b);
    if (a !== undefined && b !== undefined) union(a, b);
  }
  const groups = new Map<number, number[]>();
  graph.nodes.forEach((_, position) => {
    const root = find(position);
    const members = groups.get(root);
    if (members) members.push(position);
    else groups.set(root, [position]);
  });
  const components = [...groups.entries()].sort((left, right) => left[0] - right[0]).map(([, members]) => members);
  const half = Math.max(NODE_WIDTH, NODE_HEIGHT) / 2;
  const maxExtent = Math.max(...components.map((members) => ringRadius(members.length) + half), 0);
  const cell = maxExtent * 2 + COMPONENT_GAP;
  const columns = Math.max(1, Math.ceil(Math.sqrt(components.length)));
  const rows = Math.ceil(components.length / columns);
  const raw = new Map<string, Point>();
  components.forEach((members, componentIndex) => {
    const column = componentIndex % columns;
    const row = Math.floor(componentIndex / columns);
    const centerX = (column - (columns - 1) / 2) * cell;
    const centerY = (row - (rows - 1) / 2) * cell;
    const radius = ringRadius(members.length);
    if (members.length === 1) {
      raw.set(graph.nodes[members[0]!]!.id, { x: centerX, y: centerY });
      return;
    }
    members.forEach((member, offset) => {
      const angle = (2 * Math.PI * offset) / members.length - Math.PI / 2;
      raw.set(graph.nodes[member]!.id, { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) });
    });
  });
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of raw.values()) {
    minX = Math.min(minX, point.x - NODE_WIDTH / 2);
    maxX = Math.max(maxX, point.x + NODE_WIDTH / 2);
    minY = Math.min(minY, point.y - NODE_HEIGHT / 2);
    maxY = Math.max(maxY, point.y + NODE_HEIGHT / 2);
  }
  const offsetX = CANVAS_PADDING - minX, offsetY = CANVAS_PADDING - minY;
  const positions: Record<string, Point> = {};
  for (const [id, point] of raw) positions[id] = { x: point.x + offsetX, y: point.y + offsetY };
  return {
    positions,
    width: (maxX - minX) + CANVAS_PADDING * 2,
    height: (maxY - minY) + CANVAS_PADDING * 2,
  };
}
