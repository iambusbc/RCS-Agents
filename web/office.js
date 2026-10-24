import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// ---------- scene ----------
const host = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1218);
scene.fog = new THREE.Fog(0x0f1218, 30, 60);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
camera.position.set(0, 14, 16);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, -1);
controls.maxPolarAngle = Math.PI / 2.2;
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xdde6ff, 0x202530, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(6, 14, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
scene.add(sun);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(30, 22), new THREE.MeshStandardMaterial({ color: 0x232a36 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(30, 30, 0x2f3846, 0x2a3140);
grid.position.y = 0.01;
scene.add(grid);

// Kanban wall at the back.
const wall = new THREE.Mesh(new THREE.BoxGeometry(14, 4, 0.2), new THREE.MeshStandardMaterial({ color: 0x1b212c }));
wall.position.set(0, 2, -9.5);
scene.add(wall);
const wallCards = new THREE.Group();
scene.add(wallCards);

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

function textSprite(text, { size = 0.5, color = "#e6e9ef", bg = "rgba(22,27,36,.85)" } = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = "600 40px system-ui, 'Noto Sans Thai', sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 40;
  canvas.width = w;
  canvas.height = 64;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, w, 64, 18);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 20, 34);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }));
  sprite.scale.set((w / 64) * size, size, 1);
  sprite.renderOrder = 10;
  return sprite;
}

// ---------- agents ----------
const agents = new Map(); // id -> { role, group, body, light, screen, bubble, state, last, tokens }
const DESK_SCALE = 1.3;

function buildAgent(role) {
  const group = new THREE.Group();
  const [x, z] = role.desk;
  group.position.set(x * DESK_SCALE, 0, z * DESK_SCALE);

  const desk = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.12, 1.1), new THREE.MeshStandardMaterial({ color: 0x5a4636 }));
  desk.position.set(0, 0.9, -0.6);
  desk.castShadow = desk.receiveShadow = true;
  for (const [lx, lz] of [[-1, -0.1], [1, -0.1], [-1, -1.1], [1, -1.1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 0.08), desk.material);
    leg.position.set(lx, 0.45, lz);
    group.add(leg);
  }
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x000000 });
  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.05), screenMat);
  screen.position.set(0, 1.3, -0.9);

  const color = COLORS[role.id] ?? 0xcccccc;
  const body = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 4, 12), new THREE.MeshStandardMaterial({ color }));
  torso.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 16), new THREE.MeshStandardMaterial({ color: 0xf1d3b3 }));
  head.position.y = 1.35;
  torso.castShadow = head.castShadow = true;
  body.add(torso, head);
  body.position.z = 0.1;
  body.rotation.y = Math.PI; // face the desk

  const light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: STATE_LIGHT.idle }));
  light.position.set(0.95, 1.1, -0.6);

  const label = textSprite(role.title, { size: 0.42 });
  label.position.set(0, 2.15, 0);

  const bubble = textSprite("…", { size: 0.45, bg: "rgba(255,181,71,.95)", color: "#1b1b1b" });
  bubble.position.set(0.5, 1.85, 0);
  bubble.visible = false;

  group.add(desk, screen, body, light, label, bubble);
  [torso, head].forEach((m) => (m.userData.agentId = role.id));
  scene.add(group);

  agents.set(role.id, {
    role, group, body, light, screen, bubble, state: "idle", last: "", tokens: { in: 0, out: 0, cached: 0, costUsd: 0 },
  });
}

function setState(id, state) {
  const a = agents.get(id);
  if (!a) return;
  a.state = state;
  a.light.material.color.setHex(STATE_LIGHT[state] ?? STATE_LIGHT.idle);
  a.bubble.visible = state === "thinking";
  a.screen.material.emissive.setHex(state === "working" ? 0x2a5cff : state === "reviewing" ? 0x7a2a55 : 0x000000);
  if (selected === id) renderAgentCard();
}

// ---------- effects ----------
const effects = []; // { update(dt) -> boolean alive }

function flyPaper(fromId, toId) {
  const from = agents.get(fromId), to = agents.get(toId);
  if (!from || !to) return;
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.45), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 }));
  scene.add(paper);
  const a = from.group.position.clone().setY(1.2), b = to.group.position.clone().setY(1.2);
  let t = 0;
  effects.push({
    update(dt) {
      t += dt / 1.4;
      paper.position.lerpVectors(a, b, Math.min(t, 1));
      paper.position.y += Math.sin(Math.min(t, 1) * Math.PI) * 2;
      paper.rotation.y += dt * 4;
      if (t >= 1) { scene.remove(paper); return false; }
      return true;
    },
  });
}

function confetti(atId) {
  const at = agents.get(atId);
  if (!at) return;
  const pieces = [];
  for (let i = 0; i < 60; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.8, 0.6), side: THREE.DoubleSide }));
    m.position.copy(at.group.position).setY(2.5);
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
const tasks = new Map(); // id -> { id, title, status }
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
  // Mirror on the 3D wall: one sticky note per task.
  wallCards.clear();
  COLUMNS.forEach(([key, name], ci) => {
    const header = textSprite(name, { size: 0.35 });
    header.position.set(-5.25 + ci * 3.5, 3.6, -9.3);
    wallCards.add(header);
    [...tasks.values()].filter((t) => t.status === key).slice(-5).forEach((t, i) => {
      const color = key === "done" ? "#3ccf91" : key === "blocked" ? "#ff5d6c" : key === "review" ? "#ff5d9e" : "#5b9dff";
      const note = textSprite(t.id, { size: 0.32, bg: color, color: "#0f1218" });
      note.position.set(-5.25 + ci * 3.5, 3.05 - i * 0.48, -9.3);
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
let selected = null;
function renderAgentCard() {
  const a = agents.get(selected);
  const card = document.getElementById("agent-card");
  if (!a) { card.hidden = true; return; }
  card.hidden = false;
  document.getElementById("a-title").textContent = a.role.title;
  document.getElementById("a-model").textContent = a.role.model;
  document.getElementById("a-state").textContent = a.state;
  document.getElementById("a-last").textContent = a.last || "—";
  document.getElementById("a-tokens").textContent = `${fmt(a.tokens.in)} in · ${fmt(a.tokens.out)} out · $${a.tokens.costUsd.toFixed(3)}`;
}

const raycaster = new THREE.Raycaster();
renderer.domElement.addEventListener("click", (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = raycaster.intersectObjects(scene.children, true).find((h) => h.object.userData.agentId);
  selected = hit ? hit.object.userData.agentId : null;
  renderAgentCard();
});

// ---------- events ----------
const logEl = document.getElementById("log");
function log(ev) {
  const li = document.createElement("li");
  if (/failed|blocked|error/.test(ev.type + ev.state)) li.className = "bad";
  if (ev.type === "merged" || ev.type === "task_done") li.className = "good";
  const time = ev.ts.slice(11, 19);
  li.innerHTML = `${time} <b></b> <span></span>`;
  li.querySelector("b").textContent = ev.agent;
  li.querySelector("span").textContent = `${ev.task ? ev.task + " " : ""}${ev.type}${ev.state ? ":" + ev.state : ""}${ev.detail ? " · " + ev.detail : ""}`;
  logEl.prepend(li);
  while (logEl.children.length > 200) logEl.lastChild.remove();
}

const lastDev = new Map(); // task -> dev agent id
function handle(ev, animate = true) {
  if (ev.type !== "usage") log(ev);
  const a = agents.get(ev.agent);
  if (a && ev.detail && ev.type !== "usage") a.last = ev.detail;

  switch (ev.type) {
    case "agent_state": setState(ev.agent, ev.state); break;
    case "tool_call": setState(ev.agent, "working"); break;
    case "usage": addUsage(ev.agent, ev.tokens ?? {}); break;
    case "task_created": {
      const [title, dev] = (ev.detail ?? "").split(" → ");
      setTask(ev.task, { title, status: "doing" });
      if (dev) lastDev.set(ev.task, dev);
      if (animate && dev) flyPaper("orchestrator", dev);
      break;
    }
    case "pr_opened":
      setTask(ev.task, { status: "review" });
      if (animate) flyPaper(ev.agent, "reviewer");
      break;
    case "review":
      if (ev.detail !== "approved") {
        setTask(ev.task, { status: "doing" });
        if (animate && lastDev.get(ev.task)) flyPaper("reviewer", lastDev.get(ev.task));
      }
      break;
    case "tests":
      if (ev.detail === "fail") setState("qa", "error");
      break;
    case "merged":
      setTask(ev.task, { status: "done" });
      if (animate) confetti("orchestrator");
      break;
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
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  for (const a of agents.values()) {
    const s = a.state;
    a.body.position.y = s === "thinking" ? Math.sin(t * 3) * 0.06 + 0.04 : 0;
    a.body.rotation.z = s === "working" ? Math.sin(t * 18) * 0.03 : 0;
    a.body.rotation.y = Math.PI + (s === "reviewing" ? Math.sin(t * 1.5) * 0.4 : 0);
    if (s === "blocked" || s === "error") a.light.visible = Math.sin(t * 8) > 0;
    else a.light.visible = true;
  }
  for (let i = effects.length - 1; i >= 0; i--) if (!effects[i].update(dt)) effects.splice(i, 1);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}

const roles = await fetch("/api/roles").then((r) => r.json());
roles.forEach(buildAgent);
renderKanban();
connect();
tick();
