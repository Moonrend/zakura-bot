import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CANVAS_PADDING, MAX_RING_RADIUS, MIN_RING_RADIUS, NODE_GAP, graphPath, layoutGraph, parseGraph, ringRadius,
  type OrgGraph,
} from "../lib/org-graph.js";

const node = (id: string, status: "running" | "stopped" = "stopped") =>
  ({ id, name: id, description: "", spaceId: "s1", status });

test("graph path encodes the space id", () => {
  assert.equal(graphPath("space 1/../two"), "/api/spaces/space%201%2F..%2Ftwo/graph");
});

test("graph parsing drops malformed nodes and edges and normalizes status", () => {
  const parsed = parseGraph({
    nodes: [
      { id: "a", name: "Alpha", description: "first", spaceId: "s1", status: "running" },
      { id: "a", name: "duplicate" },
      { id: "b", name: "Bravo", status: "weird" },
      { name: "no id" },
      null,
    ],
    edges: [
      { type: "message", a: "a", b: "b" },
      { type: "group", a: "a", b: "ghost" },
      { type: "message", a: "a", b: "a" },
      { type: "other", a: "a", b: "b" },
      { type: "message", a: "a", b: "b" },
      null,
    ],
  });
  assert.deepEqual(parsed.nodes, [
    { id: "a", name: "Alpha", description: "first", spaceId: "s1", status: "running" },
    { id: "b", name: "Bravo", description: "", spaceId: "", status: "stopped" },
  ]);
  assert.deepEqual(parsed.edges, [{ type: "message", a: "a", b: "b" }]);
});

test("graph parsing is defensive for non-object payloads", () => {
  assert.deepEqual(parseGraph(null), { nodes: [], edges: [] });
  assert.deepEqual(parseGraph(undefined), { nodes: [], edges: [] });
  assert.deepEqual(parseGraph({ nodes: {}, edges: "no" }), { nodes: [], edges: [] });
  assert.deepEqual(parseGraph([]), { nodes: [], edges: [] });
});

test("ring radius grows with the node count but clamps both ways", () => {
  assert.equal(ringRadius(0), 0);
  assert.equal(ringRadius(1), 0);
  assert.equal(ringRadius(2), MIN_RING_RADIUS);
  assert.equal(ringRadius(100), MAX_RING_RADIUS);
  const mid = ringRadius(12);
  assert.ok(mid > MIN_RING_RADIUS && mid < MAX_RING_RADIUS);
  assert.equal(mid, (12 * NODE_GAP) / (2 * Math.PI));
});

test("layout is deterministic and places a connected component on a ring", () => {
  const graph: OrgGraph = { nodes: ["a", "b", "c", "d", "e", "f"].map((id) => node(id)), edges: [] };
  for (let index = 0; index < graph.nodes.length; index++) {
    graph.edges.push({ type: "group", a: graph.nodes[index]!.id, b: graph.nodes[(index + 1) % graph.nodes.length]!.id });
  }
  const first = layoutGraph(graph);
  const second = layoutGraph(graph);
  assert.deepEqual(first, second);
  assert.equal(Object.keys(first.positions).length, 6);
  const points = Object.values(first.positions);
  const centroid = points.reduce((acc, point) => ({ x: acc.x + point.x / points.length, y: acc.y + point.y / points.length }), { x: 0, y: 0 });
  const distances = points.map((point) => Math.hypot(point.x - centroid.x, point.y - centroid.y));
  for (const distance of distances) assert.ok(Math.abs(distance - distances[0]!) < 1e-6);
  assert.ok(Math.abs(distances[0]! - ringRadius(6)) < 1e-6);
});

test("layout packs disconnected components and keeps nodes inside the canvas", () => {
  const graph: OrgGraph = { nodes: [node("a"), node("b"), node("c", "running")], edges: [{ type: "message", a: "a", b: "b" }] };
  const layout = layoutGraph(graph);
  assert.equal(Object.keys(layout.positions).length, 3);
  for (const point of Object.values(layout.positions)) {
    assert.ok(point.x >= CANVAS_PADDING && point.x <= layout.width - CANVAS_PADDING);
    assert.ok(point.y >= CANVAS_PADDING && point.y <= layout.height - CANVAS_PADDING);
  }
});

test("an empty graph lays out to a zero-size canvas", () => {
  assert.deepEqual(layoutGraph({ nodes: [], edges: [] }), { positions: {}, width: 0, height: 0 });
});
