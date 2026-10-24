import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { MockAgentRunner } from "../src/agents/mock.ts";
import { EventBus, type AgentEvent } from "../src/events.ts";
import { GitRepo } from "../src/git.ts";
import { Orchestrator } from "../src/orchestrator.ts";

const dirs: string[] = [];
function tempRepo(): GitRepo {
  const dir = mkdtempSync(join(tmpdir(), "rcs-"));
  dirs.push(dir);
  return new GitRepo(join(dir, "workspace"));
}
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

test("event bus keeps a bounded history and notifies subscribers", () => {
  const bus = new EventBus(undefined, 3);
  const seen: AgentEvent[] = [];
  const off = bus.subscribe((e) => seen.push(e));
  for (let i = 0; i < 5; i++) bus.emit({ type: "message", agent: "pm", detail: String(i) });
  off();
  bus.emit({ type: "message", agent: "pm", detail: "after" });
  assert.equal(seen.length, 5);
  assert.deepEqual(bus.recent().map((e) => e.detail), ["3", "4", "after"]);
});

test("a request goes card -> branch -> review loop -> merge on main", async () => {
  const repo = tempRepo();
  const bus = new EventBus();
  const orchestrator = new Orchestrator(repo, new MockAgentRunner(bus, 0), bus);

  const outcome = await orchestrator.runTask("add a health check endpoint");

  assert.equal(outcome.status, "merged");
  assert.equal(outcome.rounds, 2, "mock reviewer asks for one change first");
  assert.equal(outcome.card.assignee, "backend");
  assert.ok(existsSync(join(repo.root, "tasks", "T-001.md")));
  assert.match(readFileSync(join(repo.root, "src", "t-001.ts"), "utf8"), /Generated for T-001/);
  assert.equal(await repo.currentBranch(), "main");
  assert.match(await repo.git(["log", "--oneline", "-1"]), /T-001: add a health check endpoint/);

  const types = bus.recent().map((e) => e.type);
  for (const t of ["task_created", "commit", "pr_opened", "review", "merged", "task_done"]) {
    assert.ok(types.includes(t as AgentEvent["type"]), `missing ${t}`);
  }
});

test("failing tests go back to the developer and block after max rounds", async () => {
  const repo = tempRepo();
  const bus = new EventBus();
  const orchestrator = new Orchestrator(repo, new MockAgentRunner(bus, 0), bus, {
    maxRounds: 2,
    testCmd: "echo boom >&2 && exit 1",
  });

  const outcome = await orchestrator.runTask("add login page");

  assert.equal(outcome.status, "blocked");
  assert.equal(outcome.card.assignee, "frontend");
  assert.equal(bus.recent().filter((e) => e.type === "tests").length, 2);
  assert.ok(!bus.recent().some((e) => e.type === "merged"));
});

test("task ids increment per repo", async () => {
  const repo = tempRepo();
  const bus = new EventBus();
  const orchestrator = new Orchestrator(repo, new MockAgentRunner(bus, 0), bus);
  await orchestrator.runTask("first");
  const second = await orchestrator.runTask("second");
  assert.equal(second.card.id, "T-002");
});
