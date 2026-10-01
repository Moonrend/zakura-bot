import assert from "node:assert/strict";
import { test } from "node:test";
import { AVATAR_COLORS, AVATAR_SHAPES, avatarColorValue, avatarFields, avatarShapeId } from "../lib/avatar.js";
import { decodeServerFrame } from "../lib/channel/protocol.js";

test("avatar shapes and colors are fixed, unique and well formed", () => {
  assert.equal(AVATAR_SHAPES.length, 8);
  assert.equal(new Set(AVATAR_SHAPES.map((shape) => shape.id)).size, 8);
  assert.equal(AVATAR_COLORS.length, 10);
  assert.equal(new Set(AVATAR_COLORS.map((color) => color.value)).size, 10);
  for (const color of AVATAR_COLORS) assert.match(color.value, /^#[0-9a-f]{6}$/i);
});

test("unknown shape and color ids fall back to the legacy circle and default swatch", () => {
  assert.equal(avatarShapeId("hexagon"), "hexagon");
  assert.equal(avatarShapeId("wat"), "circle");
  assert.equal(avatarShapeId(null), "circle");
  assert.equal(avatarShapeId(undefined), "circle");
  assert.equal(avatarColorValue("#30a46c"), "#30a46c");
  assert.equal(avatarColorValue("#123456"), "#123456");
  assert.equal(avatarColorValue("not-a-color"), "#1084fe");
  assert.equal(avatarColorValue(null), "#1084fe");
});

test("avatar fields prefer the chosen pair and image over the legacy color", () => {
  const legacy = { color: "#1084fe" };
  assert.deepEqual(avatarFields(legacy), { color: "#1084fe", shape: null, url: null });
  assert.deepEqual(avatarFields({ color: "#1084fe", avatarColor: "#e5484d", avatarShape: "blob" }),
    { color: "#e5484d", shape: "blob", url: null });
  assert.deepEqual(avatarFields({ color: "#1084fe", avatarUrl: "https://example.com/a.png" }),
    { color: "#1084fe", shape: null, url: "https://example.com/a.png" });
});

test("roster frames carry avatar fields without dropping legacy agents", () => {
  const frame = decodeServerFrame(JSON.stringify({ type: "agents", agents: [
    { id: "a", name: "A", status: "idle", avatarColor: "#e5484d", avatarShape: "blob", avatarUrl: "https://example.com/a.png" },
    { id: "b", name: "B", status: "idle" },
  ] }));
  assert.equal(frame?.type, "agents");
  if (frame?.type !== "agents") return;
  assert.deepEqual(frame.agents[0], {
    id: "a", name: "A", title: undefined, preview: undefined, status: "idle", color: "#1084fe", unread: false,
    avatarColor: "#e5484d", avatarShape: "blob", avatarUrl: "https://example.com/a.png",
  });
  assert.equal(frame.agents[1]!.avatarColor, undefined);
  assert.equal(frame.agents[1]!.avatarUrl, undefined);
  // A non-http avatar url is ignored rather than carried into the client.
  const bad = decodeServerFrame(JSON.stringify({ type: "agents", agents: [
    { id: "c", name: "C", status: "idle", avatarUrl: "file:///etc/passwd" },
  ] }));
  assert.equal(bad?.type, "agents");
  if (bad?.type === "agents") assert.equal(bad.agents[0]!.avatarUrl, undefined);
});
