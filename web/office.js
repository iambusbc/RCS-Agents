import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { BOUNDS, DESKS, OBSTACLES, PLACES, ROOMS, WALLS, findPath, visitSpot } from "./map.js";

// ---------- scene ----------
const host = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1218);
scene.fog = new THREE.Fog(0x0f1218, 45, 90);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
camera.position.set(-2, 31, 25);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(-2, 0, -3);
controls.maxPolarAngle = Math.PI / 2.2;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xdde6ff, 0x202530, 1.15));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(8, 22, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 16, bottom: -16 });
scene.add(sun);

function resize() {
  const { clientWidth: w, clientHeight: h } = host;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

// ---------- helpers ----------
const COLORS = {
  orchestrator: 0xffb547, pm: 0xc58cff, architect: 0x5b9dff, frontend: 0x3ccfcf,
  backend: 0x3ccf91, qa: 0xff8f5b, reviewer: 0xff5d9e, devops: 0x9aa7ff, docs: 0xd9d36a,
};
const STATE_LIGHT = {
  idle: 0x4a5263, thinking: 0xffb547, working: 0x5b9dff, reviewing: 0xff5d9e,
  blocked: 0xff5d6c, error: 0xff5d6c, done: 0x3ccf91,
};
const hex = (n) => `#${n.toString(16).padStart(6, "0")}`;

function textCanvas(text, { color = "#e6e9ef", bg = "rgba(22,27,36,.85)", px = 40 } = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = `600 ${px}px system-ui, 'Noto Sans Thai', sans-serif`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + px;
  const h = Math.round(px * 1.6);
  canvas.width = w;
  canvas.height = h;
  ctx.font = font;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h * 0.28);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, px / 2, h / 2 + 2);
  return canvas;
}

function textSprite(text, { size = 0.5, ...opts } = {}) {
  const canvas = textCanvas(text, opts);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
  sprite.scale.set((canvas.width / canvas.height) * size, size, 1);
  sprite.renderOrder = 10;
  return sprite;
}

const box = (w, h, d, color, opts = {}) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, ...opts }));
  m.castShadow = m.receiveShadow = true;
  return m;
};

// ---------- floor plan ----------
for (const room of ROOMS) {
  const [x1, x2] = room.x, [z1, z2] = room.z;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, z2 - z1), new THREE.MeshStandardMaterial({ color: room.color }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((x1 + x2) / 2, room.id === "hall" ? 0 : 0.005, (z1 + z2) / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  if (room.id === "hall") continue;
  // Room name painted on the floor, near the room's north-west corner.
  const canvas = textCanvas(room.name, { bg: null, color: "rgba(230,233,239,.45)", px: 56 });
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry((canvas.width / canvas.height) * 0.9, 0.9),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
  );
  label.rotation.x = -Math.PI / 2;
  label.position.set(x1 + 0.4 + label.geometry.parameters.width / 2, 0.02, z1 + 0.9);
  scene.add(label);
}

const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4252 });
for (const [x1, z1, x2, z2] of WALLS) {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(len + 0.15, 1.3, 0.15), wallMat);
  wall.position.set((x1 + x2) / 2, 0.65, (z1 + z2) / 2);
  wall.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
  wall.castShadow = wall.receiveShadow = true;
  scene.add(wall);
}

// Furniture that isn't a desk (desks are built with their agent).
const wood = 0x5a4636;
const table = box(3, 0.1, 1.2, wood);
table.position.set(-4, 0.85, -9);
scene.add(table);
for (let i = 0; i < 5; i++) {
  const rack = box(1, 2.2, 0.8, 0x1c2230, { emissive: 0x0a1a10 });
  rack.position.set(10 + i * 1.2, 1.1, -11.4);
  scene.add(rack);
  for (let j = 0; j < 4; j++) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.02), new THREE.MeshBasicMaterial({ color: j % 2 ? 0x3ccf91 : 0x5b9dff }));
    led.position.set(10 + i * 1.2, 0.5 + j * 0.45, -10.99);
    scene.add(led);
  }
}
const shelf = box(3.6, 2, 1.1, 0x4a3a2c);
shelf.position.set(-13.9, 1, 11.15);
scene.add(shelf);
const bar = box(1.1, 1.1, 2.4, 0x6b5442);
bar.position.set(15.15, 0.55, 10.25);
scene.add(bar);
const coffee = box(0.5, 0.6, 0.5, 0x222222, { emissive: 0x331100 });
coffee.position.set(15.1, 1.4, 9.8);
scene.add(coffee);
const pantryTable = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.08, 24), new THREE.MeshStandardMaterial({ color: wood }));
pantryTable.position.set(11, 0.8, 9);
pantryTable.castShadow = true;
scene.add(pantryTable);
for (const [x, z] of [[-15.3, -11.3], [-0.7, -5.7], [15.3, -0.4], [-6.6, 11.3], [5.4, 11.3]]) {
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0x8a5a3c }));
  pot.position.set(x, 0.2, z);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), new THREE.MeshStandardMaterial({ color: 0x3f8f4f, flatShading: true }));
  leaves.position.set(x, 0.8, z);
  scene.add(pot, leaves);
}

// Kanban board on the meeting room's north wall.
const board = box(6.4, 2.6, 0.1, 0xe8e8e0);
board.position.set(-4, 2.2, -11.85);
scene.add(board);
const wallCards = new THREE.Group();
scene.add(wallCards);

// ---------- agents ----------
const agents = new Map();
const SPEED = 2.6;
let selected = null;

function buildDesk(id) {
  const [x, z] = DESKS[id].seat;
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const top = box(2.2, 0.1, 0.6, wood);
  top.position.set(0, 0.85, -0.9);
  g.add(top);
  for (const lx of [-1, 1]) {
    const leg = box(0.08, 0.85, 0.5, wood);
    leg.position.set(lx, 0.42, -0.9);
    g.add(leg);
  }
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.05), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x000000 }));
  screen.position.set(0, 1.25, -1.05);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: STATE_LIGHT.idle }));
  light.position.set(0.9, 1.0, -0.8);
  const chair = box(0.5, 0.45, 0.5, 0x2c3340);
  chair.position.set(0, 0.22, 0.25);
  g.add(screen, light, chair);
  scene.add(g);
  return { screen, light };
}

function buildPerson(color) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf1d3b3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f3a });
  const hip = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.55, 0);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.38, 4, 8), dark);
    leg.position.y = -0.27;
    pivot.add(leg);
    return pivot;
  };
  const shoulder = (x) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.12, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.36, 4, 8), mat);
    arm.position.y = -0.24;
    pivot.add(arm);
    return pivot;
  };
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.4, 4, 12), mat);
  torso.position.y = 0.88;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), skin);
  head.position.y = 1.42;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.07, 0.05), dark);
  visor.position.set(0, 1.45, 0.2); // marks the face, so you can see which way they walk
  const legL = hip(-0.11), legR = hip(0.11), armL = shoulder(-0.32), armR = shoulder(0.32);
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x444444 }));
  paper.position.set(0, 1.0, 0.35);
  paper.rotation.x = -0.6;
  paper.visible = false;
  root.add(torso, head, visor, legL, legR, armL, armR, paper);
  root.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { root, torso, head, legL, legR, armL, armR, paper };
}

function buildAgent(role) {
  const desk = DESKS[role.id];
  if (!desk) return;
  const { screen, light } = buildDesk(role.id);
  const color = COLORS[role.id] ?? 0xcccccc;
  const person = buildPerson(color);
  const [x, z] = desk.seat;
  person.root.position.set(x, 0, z);
  person.root.rotation.y = Math.PI; // facing the desk (north)
  person.root.traverse((m) => (m.userData.agentId = role.id));

  const label = textSprite(role.title, { size: 0.38 });
  label.position.y = 2.05;
  const bubble = textSprite("…", { size: 0.42, bg: "rgba(255,181,71,.95)", color: "#1b1b1b" });
  bubble.position.set(0.45, 1.8, 0);
  bubble.visible = false;
  person.root.add(label, bubble);
  scene.add(person.root);

  agents.set(role.id, {
    role, color, ...person, screen, light, bubble,
    home: desk.seat, path: [], queue: [], wait: 0, errand: null, heading: Math.PI, slot: agents.size % 3,
    nextWander: 10 + Math.random() * 25,
    state: "idle", last: "", tokens: { in: 0, out: 0, cached: 0, costUsd: 0 },
  });
}

const posOf = (a) => [a.root.position.x, a.root.position.z];
const atHome = (a) => !a.path.length && !a.queue.length && Math.hypot(a.root.position.x - a.home[0], a.root.position.z - a.home[1]) < 0.1;

/**
 * Plan an errand: walk to `target`, linger, walk back to the desk. A new
 * errand replaces whatever the agent was doing.
 */
function errand(id, target, { linger = 1.5, carry = false, kind = "task", onArrive } = {}) {
  const a = agents.get(id);
  if (!a) return;
  // Two visitors at the same desk stand side by side, not inside each other.
  if (kind === "task") target = [target[0], target[1] + a.slot * 0.5];
  a.path = [];
  a.errand = kind;
  a.queue = [
    { fn: () => (a.paper.visible = carry) },
    { goto: target },
    ...(onArrive ? [{ fn: onArrive }] : []),
    { fn: () => (a.paper.visible = false) },
    { wait: linger },
    { goto: a.home },
    { fn: () => { a.errand = null; } },
  ];
}

function goHome(id) {
  const a = agents.get(id);
  if (!a || atHome(a)) return;
  a.path = [];
  a.paper.visible = false;
  a.queue = [{ goto: a.home }, { fn: () => { a.errand = null; } }];
  a.errand = "home";
}

function stepAgent(a, dt, t) {
  // Next action when not walking.
  while (!a.path.length && a.queue.length && a.wait <= 0) {
    const action = a.queue.shift();
    if (action.goto) a.path = findPath(posOf(a), action.goto);
    else if (action.wait) a.wait = action.wait;
    else if (action.fn) action.fn();
  }
  if (a.wait > 0 && !a.path.length) a.wait -= dt;

  let moving = false;
  if (a.path.length) {
    const [tx, tz] = a.path[0];
    const dx = tx - a.root.position.x, dz = tz - a.root.position.z;
    const dist = Math.hypot(dx, dz);
    const step = SPEED * dt;
    if (dist <= step) {
      a.root.position.x = tx;
      a.root.position.z = tz;
      a.path.shift();
    } else {
      a.root.position.x += (dx / dist) * step;
      a.root.position.z += (dz / dist) * step;
    }
    if (dist > 0.01) a.heading = Math.atan2(dx, dz);
    moving = true;
  } else if (atHome(a)) {
    a.heading = Math.PI;
  }

  // Turn smoothly toward the heading.
  let diff = a.heading - a.root.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  a.root.rotation.y += diff * Math.min(1, dt * 10);

  // Limbs: walk cycle, typing at the desk, or still.
  const s = a.state;
  const swing = moving ? Math.sin(t * 10) * 0.6 : 0;
  a.legL.rotation.x = swing;
  a.legR.rotation.x = -swing;
  const typing = !moving && atHome(a) && s === "working";
  a.armL.rotation.x = moving ? -swing * 0.8 : typing ? -1.1 + Math.sin(t * 22) * 0.15 : 0;
  a.armR.rotation.x = moving ? swing * 0.8 : typing ? -1.1 + Math.sin(t * 22 + 1.5) * 0.15 : 0;
  if (a.paper.visible) a.armR.rotation.x = -1.0;
  a.root.position.y = moving ? Math.abs(Math.sin(t * 10)) * 0.05 : s === "thinking" ? Math.sin(t * 3) * 0.03 + 0.03 : 0;
  a.head.rotation.y = !moving && s === "reviewing" ? Math.sin(t * 1.5) * 0.5 : 0;
  a.light.visible = s === "blocked" || s === "error" ? Math.sin(t * 8) > 0 : true;

  // Idle people stretch their legs now and then: coffee or the meeting room.
  if (s === "idle" && atHome(a) && !a.errand) {
    a.nextWander -= dt;
    if (a.nextWander <= 0) {
      a.nextWander = 25 + Math.random() * 35;
      const spots = Math.random() < 0.65 ? PLACES.pantry : PLACES.meeting;
      errand(a.role.id, spots[Math.floor(Math.random() * spots.length)], { linger: 4 + Math.random() * 4, kind: "wander" });
    }
  }
}

function setState(id, state) {
  const a = agents.get(id);
  if (!a) return;
  a.state = state;
  a.light.material.color.setHex(STATE_LIGHT[state] ?? STATE_LIGHT.idle);
  a.bubble.visible = state === "thinking";
  a.screen.material.emissive.setHex(state === "working" ? 0x2a5cff : state === "reviewing" ? 0x7a2a55 : 0x000000);
  // Called back to work: drop a coffee break, but never a delivery in progress.
  if (state !== "idle" && a.errand === "wander") goHome(id);
  if (selected === id) renderAgentCard();
}

// ---------- effects ----------
const effects = [];

function confettiAt(x, z) {
  const pieces = [];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 0.12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.8, 0.6), side: THREE.DoubleSide }),
    );
    m.position.set(x, 2.4, z);
    m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 4, (Math.random() - 0.5) * 6);
    scene.add(m);
    pieces.push(m);
  }
  let life = 2.2;
  effects.push({
    update(dt) {
      life -= dt;
      for (const p of pieces) {
        p.userData.v.y -= 9.8 * dt;
        p.position.addScaledVector(p.userData.v, dt);
        p.rotation.x += dt * 8;
      }
      if (life <= 0) { pieces.forEach((p) => scene.remove(p)); return false; }
      return true;
    },
  });
}

// ---------- task board ----------
const tasks = new Map();
const COLUMNS = [["doing", "Doing"], ["review", "Review"], ["done", "Done"], ["blocked", "Blocked"]];

function setTask(id, patch) {
  if (!id) return;
  tasks.set(id, { id, title: id, status: "doing", ...tasks.get(id), ...patch });
  renderKanban();
}

function renderKanban() {
  const el = document.getElementById("kanban");
  el.innerHTML = "";
  for (const [key, name] of COLUMNS) {
    const col = document.createElement("div");
    col.className = "col";
    col.innerHTML = `<h3>${name}</h3>`;
    for (const t of tasks.values()) {
      if (t.status !== key) continue;
      const card = document.createElement("div");
      card.className = `card ${key}`;
      card.textContent = `${t.id} ${t.title}`;
      col.appendChild(card);
    }
    el.appendChild(col);
  }
  wallCards.clear();
  COLUMNS.forEach(([key, name], ci) => {
    const x = -6.3 + ci * 1.55;
    const header = textSprite(name, { size: 0.28 });
    header.position.set(x, 3.25, -11.7);
    wallCards.add(header);
    [...tasks.values()].filter((t) => t.status === key).slice(-4).forEach((t, i) => {
      const color = key === "done" ? "#3ccf91" : key === "blocked" ? "#ff5d6c" : key === "review" ? "#ff5d9e" : "#5b9dff";
      const note = textSprite(t.id, { size: 0.26, bg: color, color: "#0f1218" });
      note.position.set(x, 2.8 - i * 0.4, -11.7);
      wallCards.add(note);
    });
  });
}

// ---------- token meter ----------
const totals = { in: 0, out: 0, cached: 0, costUsd: 0 };
const fmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

function addUsage(agentId, t) {
  for (const k of Object.keys(totals)) totals[k] += t[k] ?? 0;
  const a = agents.get(agentId);
  if (a) for (const k of Object.keys(a.tokens)) a.tokens[k] += t[k] ?? 0;
  document.getElementById("m-in").textContent = fmt(totals.in);
  document.getElementById("m-out").textContent = fmt(totals.out);
  document.getElementById("m-cache").textContent = totals.in ? `${Math.round((totals.cached / totals.in) * 100)}%` : "0%";
  document.getElementById("m-cost").textContent = `$${totals.costUsd.toFixed(2)}`;
  if (selected === agentId) renderAgentCard();
}

// ---------- agent card ----------
function renderAgentCard() {
  const a = agents.get(selected);
  const card = document.getElementById("agent-card");
  if (!a) { card.hidden = true; return; }
  card.hidden = false;
  document.getElementById("a-title").textContent = a.role.title;
  document.getElementById("a-model").textContent = a.role.model;
  document.getElementById("a-state").textContent = a.state + (a.errand && a.errand !== "home" ? " · กำลังเดิน" : "");
  document.getElementById("a-last").textContent = a.last || "—";
  document.getElementById("a-tokens").textContent = `${fmt(a.tokens.in)} in · ${fmt(a.tokens.out)} out · $${a.tokens.costUsd.toFixed(3)}`;
}

function select(id) {
  selected = id;
  renderAgentCard();
}

const raycaster = new THREE.Raycaster();
renderer.domElement.addEventListener("click", (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObjects(scene.children, true).find((h) => h.object.userData.agentId);
  select(hit ? hit.object.userData.agentId : null);
});

// ---------- minimap ----------
const mini = document.getElementById("minimap");
const mctx = mini.getContext("2d");
const MINI_SCALE = 7.5; // px per world unit
mini.width = (BOUNDS.maxX - BOUNDS.minX) * MINI_SCALE * devicePixelRatio;
mini.height = (BOUNDS.maxZ - BOUNDS.minZ) * MINI_SCALE * devicePixelRatio;
const mx = (x) => (x - BOUNDS.minX) * MINI_SCALE;
const mz = (z) => (z - BOUNDS.minZ) * MINI_SCALE;

function drawMinimap() {
  mctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  for (const room of ROOMS) {
    mctx.fillStyle = room.color;
    mctx.fillRect(mx(room.x[0]), mz(room.z[0]), (room.x[1] - room.x[0]) * MINI_SCALE, (room.z[1] - room.z[0]) * MINI_SCALE);
  }
  mctx.fillStyle = "#3a4252";
  for (const [x1, z1, x2, z2] of OBSTACLES) mctx.fillRect(mx(x1), mz(z1), (x2 - x1) * MINI_SCALE, (z2 - z1) * MINI_SCALE);
  mctx.strokeStyle = "#8b93a5";
  mctx.lineWidth = 1.5;
  mctx.beginPath();
  for (const [x1, z1, x2, z2] of WALLS) {
    mctx.moveTo(mx(x1), mz(z1));
    mctx.lineTo(mx(x2), mz(z2));
  }
  mctx.stroke();
  mctx.font = "600 9px system-ui, 'Noto Sans Thai', sans-serif";
  mctx.fillStyle = "rgba(230,233,239,.55)";
  for (const room of ROOMS) if (room.id !== "hall") mctx.fillText(room.name, mx(room.x[0]) + 3, mz(room.z[0]) + 11);
  for (const a of agents.values()) {
    const x = mx(a.root.position.x), y = mz(a.root.position.z);
    // Walking agents trail a dotted line to where they are going.
    if (a.path.length) {
      mctx.strokeStyle = hex(a.color);
      mctx.setLineDash([2, 3]);
      mctx.beginPath();
      mctx.moveTo(x, y);
      for (const [px, pz] of a.path) mctx.lineTo(mx(px), mz(pz));
      mctx.stroke();
      mctx.setLineDash([]);
    }
    mctx.fillStyle = hex(a.color);
    mctx.beginPath();
    mctx.arc(x, y, a.role.id === selected ? 6 : 4.5, 0, Math.PI * 2);
    mctx.fill();
    if (a.role.id === selected) {
      mctx.strokeStyle = "#fff";
      mctx.stroke();
    }
  }
}

mini.addEventListener("click", (e) => {
  const r = mini.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * (BOUNDS.maxX - BOUNDS.minX) + BOUNDS.minX;
  const z = ((e.clientY - r.top) / r.height) * (BOUNDS.maxZ - BOUNDS.minZ) + BOUNDS.minZ;
  let best = null, bestD = 1.5;
  for (const a of agents.values()) {
    const d = Math.hypot(a.root.position.x - x, a.root.position.z - z);
    if (d < bestD) { best = a.role.id; bestD = d; }
  }
  select(best);
  if (best) controls.target.set(agents.get(best).root.position.x, 0, agents.get(best).root.position.z);
});

// ---------- events ----------
const logEl = document.getElementById("log");
function log(ev) {
  const li = document.createElement("li");
  if (/failed|blocked|error/.test(ev.type + ev.state)) li.className = "bad";
  if (ev.type === "merged" || ev.type === "task_done") li.className = "good";
  li.innerHTML = `${ev.ts.slice(11, 19)} <b></b> <span></span>`;
  li.querySelector("b").textContent = ev.agent;
  li.querySelector("span").textContent = `${ev.task ? ev.task + " " : ""}${ev.type}${ev.state ? ":" + ev.state : ""}${ev.detail ? " · " + ev.detail : ""}`;
  logEl.prepend(li);
  while (logEl.children.length > 200) logEl.lastChild.remove();
}

const devOf = new Map(); // task -> developer role id
function handle(ev, live = true) {
  if (ev.type !== "usage") log(ev);
  const a = agents.get(ev.agent);
  if (a && ev.detail && ev.type !== "usage") a.last = ev.detail;
  const dev = devOf.get(ev.task);

  switch (ev.type) {
    case "agent_state": setState(ev.agent, ev.state); break;
    case "tool_call": setState(ev.agent, "working"); break;
    case "usage": addUsage(ev.agent, ev.tokens ?? {}); break;
    case "task_created": {
      const [title, assignee] = (ev.detail ?? "").split(" → ");
      setTask(ev.task, { title, status: "doing" });
      if (assignee) devOf.set(ev.task, assignee);
      // The CEO walks the task card over to the developer.
      if (live && DESKS[assignee]) errand("orchestrator", visitSpot(assignee), { carry: true });
      break;
    }
    case "tests":
      if (ev.detail === "fail") setState("qa", "error");
      if (live && dev) errand("qa", visitSpot(dev), { linger: 1.2 });
      break;
    case "pr_opened":
      setTask(ev.task, { status: "review" });
      // The developer brings the PR to the review room.
      if (live) errand(ev.agent, visitSpot("reviewer"), { carry: true });
      break;
    case "review":
      if (ev.detail !== "approved") {
        setTask(ev.task, { status: "doing" });
        // The reviewer goes over to explain the requested changes.
        if (live && dev) errand("reviewer", visitSpot(dev), { linger: 2 });
      }
      break;
    case "merged": {
      setTask(ev.task, { status: "done" });
      if (!live) break;
      // Everyone on the task meets in the meeting room to celebrate.
      const [cx, cz] = [-4, -9];
      errand("orchestrator", PLACES.meeting[0], { linger: 3, onArrive: () => confettiAt(cx, cz) });
      if (dev) errand(dev, PLACES.meeting[1], { linger: 3 });
      errand("reviewer", PLACES.meeting[4], { linger: 3 });
      break;
    }
    case "task_failed": setTask(ev.task, { status: "blocked" }); break;
  }
}

function connect() {
  const conn = document.getElementById("conn");
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.onopen = () => { conn.textContent = "live"; conn.classList.add("on"); };
  ws.onclose = () => { conn.textContent = "reconnecting…"; conn.classList.remove("on"); setTimeout(connect, 2000); };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.kind === "history") msg.events.forEach((e) => handle(e, false));
    else handle(msg.event);
  };
}

document.getElementById("task-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("task-input");
  const request = input.value.trim();
  if (!request) return;
  input.value = "";
  await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request }) });
});

// ---------- loop ----------
const clock = new THREE.Clock();
let miniTimer = 0;
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  for (const a of agents.values()) stepAgent(a, dt, t);
  for (let i = effects.length - 1; i >= 0; i--) if (!effects[i].update(dt)) effects.splice(i, 1);
  miniTimer -= dt;
  if (miniTimer <= 0) {
    drawMinimap();
    miniTimer = 0.1;
    if (selected) renderAgentCard();
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

const roles = await fetch("/api/roles").then((r) => r.json());
roles.forEach(buildAgent);
renderKanban();
connect();
tick();
