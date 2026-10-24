import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { ClaudeAgentRunner } from "./agents/claude.ts";
import { MockAgentRunner } from "./agents/mock.ts";
import { EventBus } from "./events.ts";
import { GitRepo } from "./git.ts";
import { Orchestrator } from "./orchestrator.ts";
import { startServer } from "./server.ts";

const { values } = parseArgs({
  options: {
    mock: { type: "boolean", default: false },
    repo: { type: "string", default: process.env.TARGET_REPO ?? "workspace" },
    port: { type: "string", default: process.env.PORT ?? "4317" },
    task: { type: "string", multiple: true },
  },
});

const bus = new EventBus(resolve("data/events.jsonl"));
const repo = new GitRepo(resolve(values.repo!));
const runner = values.mock ? new MockAgentRunner(bus) : new ClaudeAgentRunner(bus);
const orchestrator = new Orchestrator(repo, runner, bus, {
  maxRounds: Number(process.env.MAX_ROUNDS ?? 3),
  taskBudgetUsd: Number(process.env.TASK_BUDGET_USD ?? 2),
  testCmd: process.env.TEST_CMD,
});

// Tasks run one at a time so merges into main never race.
let queue = Promise.resolve();
function submit(request: string) {
  queue = queue.then(async () => {
    try {
      const outcome = await orchestrator.runTask(request);
      console.log(
        `${outcome.card.id} ${outcome.status} in ${outcome.rounds} round(s), ` +
          `${outcome.usage.in} in / ${outcome.usage.out} out tokens, ~$${outcome.usage.costUsd.toFixed(3)}`,
      );
    } catch (err) {
      console.error("task error:", err);
      bus.emit({ type: "task_failed", agent: "orchestrator", detail: String(err) });
    }
  });
}

console.log(`Mode: ${values.mock ? "mock (no tokens)" : "Claude Agent SDK"} · repo: ${repo.root}`);
startServer(bus, submit, Number(values.port));
for (const t of values.task ?? []) submit(t);
