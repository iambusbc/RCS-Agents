// Office floor plan and pathfinding. Pure data + math (no three.js), so the
// 3D scene, the minimap and the tests all read the same map.
//
// World units: x runs west -> east, z runs north (back, negative) -> south.
// The floor is 32 x 24, centred on the origin.

export const BOUNDS = { minX: -16, maxX: 16, minZ: -12, maxZ: 12 };

/** Rooms are floor zones with a name and a tint. */
export const ROOMS = [
  { id: "ceo", name: "ห้อง CEO", x: [-16, -8], z: [-12, -5], color: "#2b2f3d" },
  { id: "meeting", name: "ห้องประชุม", x: [-8, 0], z: [-12, -5], color: "#2d2a38" },
  { id: "review", name: "ห้องรีวิวโค้ด", x: [0, 8], z: [-12, -5], color: "#352833" },
  { id: "ops", name: "ห้องเซิร์ฟเวอร์", x: [8, 16], z: [-12, -5], color: "#262e3a" },
  { id: "hall", name: "ทางเดิน", x: [-16, 16], z: [-5, -1], color: "#20252f" },
  { id: "product", name: "Product & Docs", x: [-16, -6], z: [-1, 12], color: "#2a2d3a" },
  { id: "dev", name: "Dev Floor", x: [-6, 6], z: [-1, 12], color: "#233037" },
  { id: "qa", name: "QA Lab", x: [6, 16], z: [-1, 5], color: "#332d27" },
  { id: "pantry", name: "Pantry", x: [6, 16], z: [5, 12], color: "#2e3127" },
];

/**
 * Walls as segments [x1, z1, x2, z2]. Each door is a 2-unit gap left in a
 * wall, so the gaps are where agents can pass between rooms and the hall.
 */
export const WALLS = [
  // Outer shell.
  [-16, -12, 16, -12], [-16, 12, 16, 12], [-16, -12, -16, 12], [16, -12, 16, 12],
  // North rooms: partitions and their south walls, a door in each.
  [-8, -12, -8, -5], [0, -12, 0, -5], [8, -12, 8, -5],
  [-16, -5, -13, -5], [-11, -5, -8, -5],
  [-8, -5, -5, -5], [-3, -5, 0, -5],
  [0, -5, 3, -5], [5, -5, 8, -5],
  [8, -5, 11, -5], [13, -5, 16, -5],
  // South rooms: north walls with doors, the dev floor stays open plan.
  [-16, -1, -12, -1], [-10, -1, -6, -1],
  [6, -1, 10, -1], [12, -1, 16, -1],
  [-6, -1, -6, 4], [-6, 6, -6, 12],
  [6, -1, 6, 7], [6, 9, 6, 12],
  [6, 5, 10, 5], [12, 5, 16, 5],
];

/**
 * Where each role sits. Desks face north (the desk is 1 unit north of the
 * seat). `visit` is where a colleague stands when they come over.
 */
export const DESKS = {
  orchestrator: { seat: [-12, -7], room: "ceo" },
  reviewer: { seat: [4, -7], room: "review" },
  devops: { seat: [12, -7], room: "ops" },
  pm: { seat: [-13, 3], room: "product" },
  architect: { seat: [-9, 3], room: "product" },
  docs: { seat: [-11, 8], room: "product" },
  frontend: { seat: [-3, 3], room: "dev" },
  backend: { seat: [3, 3], room: "dev" },
  qa: { seat: [11, 2], room: "qa" },
};

export const visitSpot = (role) => {
  const [x, z] = DESKS[role].seat;
  return [x + 1.4, z + 0.4];
};

/** Spots people go to when they are not at their desk. */
export const PLACES = {
  meeting: [[-6, -8], [-2, -8], [-6, -10], [-2, -10], [-4, -7], [-4, -11]],
  pantry: [[9, 8], [9.5, 10.5], [13, 8], [10.5, 11], [12.5, 10.5]],
  ceoGuest: [[-10, -7]],
};

/** Furniture that blocks walking: [x1, z1, x2, z2]. */
export const OBSTACLES = [
  ...Object.values(DESKS).map(({ seat: [x, z] }) => [x - 1.1, z - 1.2, x + 1.1, z - 0.6]),
  [-5.5, -9.6, -2.5, -8.4], // meeting table
  [9.5, -11.8, 15.5, -11], // server racks
  [-15.8, 10.5, -12, 11.8], // bookshelf
  [14.5, 9, 15.8, 11.5], // coffee bar
  [10.4, 8.6, 11.6, 9.4], // pantry table (centre)
];

export const roomAt = (x, z) =>
  ROOMS.find((r) => r.id !== "hall" && x >= r.x[0] && x < r.x[1] && z >= r.z[0] && z < r.z[1]) ??
  ROOMS.find((r) => r.id === "hall");

// ---------- navigation grid ----------

const CELL = 0.5;
const COLS = (BOUNDS.maxX - BOUNDS.minX) / CELL;
const ROWS = (BOUNDS.maxZ - BOUNDS.minZ) / CELL;
const CLEARANCE = 0.35;

function distToSegment(px, pz, [x1, z1, x2, z2]) {
  const dx = x2 - x1, dz = z2 - z1;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / len2));
  return Math.hypot(px - (x1 + t * dx), pz - (z1 + t * dz));
}

export function isBlocked(x, z) {
  if (x <= BOUNDS.minX + CLEARANCE || x >= BOUNDS.maxX - CLEARANCE) return true;
  if (z <= BOUNDS.minZ + CLEARANCE || z >= BOUNDS.maxZ - CLEARANCE) return true;
  if (WALLS.some((w) => distToSegment(x, z, w) < CLEARANCE)) return true;
  return OBSTACLES.some(([x1, z1, x2, z2]) => x > x1 - 0.2 && x < x2 + 0.2 && z > z1 - 0.2 && z < z2 + 0.2);
}

const blocked = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    blocked[r * COLS + c] = isBlocked(BOUNDS.minX + (c + 0.5) * CELL, BOUNDS.minZ + (r + 0.5) * CELL) ? 1 : 0;
  }
}

const toCell = (x, z) => [
  Math.max(0, Math.min(COLS - 1, Math.floor((x - BOUNDS.minX) / CELL))),
  Math.max(0, Math.min(ROWS - 1, Math.floor((z - BOUNDS.minZ) / CELL))),
];
const toWorld = (c, r) => [BOUNDS.minX + (c + 0.5) * CELL, BOUNDS.minZ + (r + 0.5) * CELL];

/** Nearest walkable cell, for targets that sit right next to furniture. */
function nearestOpen(c, r) {
  if (!blocked[r * COLS + c]) return [c, r];
  for (let d = 1; d < 6; d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        const nc = c + dc, nr = r + dr;
        if (nc >= 0 && nr >= 0 && nc < COLS && nr < ROWS && !blocked[nr * COLS + nc]) return [nc, nr];
      }
    }
  }
  return [c, r];
}

function lineOfSight([x1, z1], [x2, z2]) {
  const steps = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 0.2);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    // Exact geometry, not the grid: a cell centre can be clear while a
    // straight run through that cell still clips a wall end.
    if (isBlocked(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t)) return false;
  }
  return true;
}

/**
 * A* over the 0.5-unit grid (8 directions, no corner cutting), then the path
 * is pulled tight with line-of-sight checks so agents walk in straight runs.
 * Returns world points from start (exclusive) to goal (inclusive), or [] if
 * the goal can't be reached.
 */
export function findPath(from, to) {
  const [sc, sr] = nearestOpen(...toCell(...from));
  const [gc, gr] = nearestOpen(...toCell(...to));
  const start = sr * COLS + sc, goal = gr * COLS + gc;
  const g = new Float32Array(COLS * ROWS).fill(Infinity);
  const came = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const h = (i) => Math.hypot((i % COLS) - gc, Math.floor(i / COLS) - gr);
  const open = [[h(start), start]];
  g[start] = 0;

  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[best][0]) best = i;
    const [, cur] = open.splice(best, 1)[0];
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const c = cur % COLS, r = Math.floor(cur / COLS);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const nc = c + dc, nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
        const n = nr * COLS + nc;
        if (blocked[n] || closed[n]) continue;
        if (dc && dr && (blocked[r * COLS + nc] || blocked[nr * COLS + c])) continue;
        const cost = g[cur] + (dc && dr ? Math.SQRT2 : 1);
        if (cost < g[n]) {
          g[n] = cost;
          came[n] = cur;
          open.push([cost + h(n), n]);
        }
      }
    }
  }
  if (start !== goal && came[goal] === -1) return [];

  const cells = [];
  for (let i = goal; i !== -1; i = came[i]) cells.unshift(toWorld(i % COLS, Math.floor(i / COLS)));
  cells[cells.length - 1] = [...to];
  const path = [];
  let anchor = [...from];
  for (let i = 1; i < cells.length; i++) {
    if (!lineOfSight(anchor, cells[i])) {
      path.push(cells[i - 1]);
      anchor = cells[i - 1];
    }
  }
  path.push(cells[cells.length - 1]);
  return path;
}
