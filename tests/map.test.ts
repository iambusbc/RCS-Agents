import assert from "node:assert/strict";
import { test } from "node:test";
import { ROLES } from "../src/config/roles.ts";
import { DESKS, PLACES, findPath, isBlocked, roomAt, visitSpot } from "../web/map.js";

type Point = [number, number];

const spots: [string, Point][] = [
  ...Object.entries(DESKS).map(([id, d]) => [`${id} seat`, d.seat as Point] as [string, Point]),
  // Visitors stand at the visit spot shifted 0, 0.5 or 1 unit south (office.js `slot`).
  ...Object.keys(DESKS).flatMap((id) =>
    [0, 0.5, 1].map((dz) => {
      const [x, z] = visitSpot(id) as Point;
      return [`${id} visit+${dz}`, [x, z + dz]] as [string, Point];
    }),
  ),
  ...Object.entries(PLACES).flatMap(([name, list]) =>
    (list as Point[]).map((p, i) => [`${name}[${i}]`, p] as [string, Point]),
  ),
];

test("every role has a desk inside its room", () => {
  for (const id of Object.keys(ROLES)) {
    const desk = DESKS[id as keyof typeof DESKS];
    assert.ok(desk, `${id} has no desk`);
    assert.equal(roomAt(...desk.seat)?.id, desk.room, `${id} sits outside ${desk.room}`);
  }
});

test("seats, visit spots and meeting places are walkable", () => {
  for (const [name, [x, z]] of spots) assert.ok(!isBlocked(x, z), `${name} is inside a wall or furniture`);
});

test("every spot can reach every other spot", () => {
  for (const [fromName, from] of spots) {
    for (const [toName, to] of spots) {
      if (fromName === toName) continue;
      const path = findPath(from, to);
      assert.ok(path.length > 0, `no path ${fromName} -> ${toName}`);
      assert.deepEqual(path.at(-1), to);
    }
  }
});

test("paths never pass through walls", () => {
  const path = [DESKS.orchestrator.seat as Point, ...(findPath(DESKS.orchestrator.seat, DESKS.qa.seat) as Point[])];
  for (let i = 1; i < path.length; i++) {
    const [x1, z1] = path[i - 1], [x2, z2] = path[i];
    const steps = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.1);
    for (let s = 1; s < steps; s++) {
      const x = x1 + ((x2 - x1) * s) / steps, z = z1 + ((z2 - z1) * s) / steps;
      // Small slack: the grid is 0.5 units, the wall clearance 0.35.
      assert.ok(!isBlocked(x, z) || Math.hypot(x - x1, z - z1) < 0.5 || Math.hypot(x - x2, z - z2) < 0.5, `crosses a wall at ${x.toFixed(2)},${z.toFixed(2)}`);
    }
  }
});
