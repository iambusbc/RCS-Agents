import { exec } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { getRole } from "./config/roles.ts";
import type { EventBus, TokenUsage } from "./events.ts";
import type { GitRepo } from "./git.ts";
import type { AgentRunner } from "./agents/types.ts";
import {
  REVIEW_SCHEMA,
  TASK_CARD_SCHEMA,
  renderReviewComments,
  renderTaskCard,
  type Review,
  type TaskCard,
} from "./tasks.ts";

const sh = promisify(exec);

export interface OrchestratorOptions {
  /** Review rounds before the task is handed back to you. */
  maxRounds?: number;
  /** Stop a task once its estimated cost passes this many USD. */
  taskBudgetUsd?: number;
  /** Shell command run in the worktree before review (e.g. "npm test"). */
  testCmd?: string;
  /** Diffs longer than this are cut before the reviewer sees them. */
  maxDiffChars?: number;
}

export interface TaskOutcome {
  card: TaskCard;
  status: "merged" | "blocked" | "failed";
  rounds: number;
  usage: TokenUsage;
  reason?: string;
}

const tail = (text: string, lines: number) => text.split("\n").slice(-lines).join("\n");

/**
 * Drives one request through the company:
 * orchestrator -> task card -> developer in its own worktree -> tests ->
 * reviewer on the diff only -> merge, looping on review comments up to
 * `maxRounds`. Everything that is not judgment (git, tests, bookkeeping) is
 * plain code so it costs no tokens.
 */
export class Orchestrator {
  private readonly maxRounds: number;
  private readonly taskBudgetUsd: number;
  private readonly testCmd?: string;
  private readonly maxDiffChars: number;

  constructor(
    private readonly repo: GitRepo,
    private readonly runner: AgentRunner,
    private readonly bus: EventBus,
    opts: OrchestratorOptions = {},
  ) {
    this.maxRounds = opts.maxRounds ?? 3;
    this.taskBudgetUsd = opts.taskBudgetUsd ?? 2;
    this.testCmd = opts.testCmd;
    this.maxDiffChars = opts.maxDiffChars ?? 60_000;
  }

  private nextTaskId(): string {
    const dir = join(this.repo.root, "tasks");
    mkdirSync(dir, { recursive: true });
    const n = readdirSync(dir).filter((f) => /^T-\d+\.md$/.test(f)).length + 1;
    return `T-${String(n).padStart(3, "0")}`;
  }

  async runTask(request: string): Promise<TaskOutcome> {
    await this.repo.ensure();
    const base = "main";
    const id = this.nextTaskId();
    const usage: TokenUsage = { in: 0, out: 0, cached: 0, costUsd: 0 };
    const add = (u: TokenUsage) => {
      usage.in += u.in;
      usage.out += u.out;
      usage.cached += u.cached;
      usage.costUsd += u.costUsd;
    };

    // 1. Task card from the orchestrator (cheap model, paths only, no file contents).
    const orchestrator = getRole("orchestrator");
    const planned = await this.runner.run({
      role: orchestrator,
      taskId: id,
      cwd: this.repo.root,
      outputSchema: TASK_CARD_SCHEMA,
      prompt: `Request: ${request}\n\nRepository files:\n${await this.repo.fileMap(base)}`,
    });
    add(planned.usage);
    const draft = planned.structured as Omit<TaskCard, "id" | "request">;
    const card: TaskCard = { id, request, ...draft };

    writeFileSync(join(this.repo.root, "tasks", `${id}.md`), renderTaskCard(card));
    await this.repo.commitAll(this.repo.root, `${id}: add task card`);
    this.bus.emit({ type: "task_created", agent: "orchestrator", task: id, detail: `${card.title} → ${card.assignee}` });

    // 2. Developer works in its own worktree; reviewer reads only the diff.
    const dev = getRole(card.assignee);
    const reviewer = getRole("reviewer");
    const branch = `feat/${id.toLowerCase()}-${dev.id}`;
    const worktree = await this.repo.addWorktree(branch, base);
    const cardText = renderTaskCard(card);
    let feedback = "";
    let round = 0;

    const finish = async (status: TaskOutcome["status"], reason?: string): Promise<TaskOutcome> => {
      if (status !== "merged") {
        this.bus.emit({ type: "agent_state", agent: dev.id, task: id, state: "blocked", detail: reason });
        this.bus.emit({ type: "task_failed", agent: "orchestrator", task: id, detail: reason });
      }
      return { card, status, rounds: round, usage, reason };
    };

    while (round < this.maxRounds) {
      round++;
      if (usage.costUsd > this.taskBudgetUsd) {
        return finish("blocked", `budget $${this.taskBudgetUsd} reached`);
      }

      const work = await this.runner.run({
        role: dev,
        taskId: id,
        cwd: worktree,
        prompt: feedback
          ? `${cardText}\nReviewer comments to fix (round ${round}):\n${feedback}`
          : `${cardText}\nYour scope: ${dev.scope.join(", ")}\n\nRepository files:\n${await this.repo.fileMap(base)}`,
      });
      add(work.usage);

      const committed = await this.repo.commitAll(worktree, `${id}: ${card.title} (round ${round})`);
      if (committed) this.bus.emit({ type: "commit", agent: dev.id, task: id, detail: branch });
      else if (round === 1) return finish("failed", "developer made no changes");

      if (this.testCmd) {
        const tests = await sh(this.testCmd, { cwd: worktree }).then(
          (r) => ({ ok: true, out: r.stdout }),
          (e: { stdout?: string; stderr?: string }) => ({ ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }),
        );
        this.bus.emit({ type: "tests", agent: "qa", task: id, detail: tests.ok ? "pass" : "fail" });
        if (!tests.ok) {
          // Only the end of the log goes back: that is where the failure is.
          feedback = `Tests failed. Last lines:\n${tail(tests.out, 40)}`;
          continue;
        }
      }

      const files = await this.repo.changedFiles(base, branch);
      this.bus.emit({ type: "pr_opened", agent: dev.id, task: id, detail: `${branch} (${files.length} files)` });

      let diff = await this.repo.diff(base, branch);
      if (diff.length > this.maxDiffChars) diff = `${diff.slice(0, this.maxDiffChars)}\n... (diff cut)`;

      const reviewed = await this.runner.run({
        role: reviewer,
        taskId: id,
        cwd: worktree,
        outputSchema: REVIEW_SCHEMA,
        prompt: `${cardText}\n\`\`\`diff\n${diff}\n\`\`\``,
      });
      add(reviewed.usage);
      const review = reviewed.structured as Review;
      this.bus.emit({
        type: "review",
        agent: reviewer.id,
        task: id,
        detail: review.verdict === "approve" ? "approved" : `${review.comments.length} comments`,
      });

      if (review.verdict === "approve") {
        await this.repo.merge(branch, base, `${id}: ${card.title}`);
        await this.repo.removeWorktree(worktree);
        this.bus.emit({ type: "merged", agent: "orchestrator", task: id, detail: `${branch} → ${base}` });
        this.bus.emit({ type: "task_done", agent: "orchestrator", task: id, tokens: usage });
        return finish("merged");
      }
      feedback = renderReviewComments(review);
    }

    return finish("blocked", `no approval after ${this.maxRounds} rounds`);
  }
}
