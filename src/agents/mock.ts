import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EventBus } from "../events.ts";
import type { AgentRequest, AgentResult, AgentRunner } from "./types.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plays every role without calling any model, so the pipeline, Git flow and
 * 3D office can be developed and demoed for free. The reviewer asks for one
 * change on the first round of each task so the review loop is visible.
 */
export class MockAgentRunner implements AgentRunner {
  private reviewed = new Set<string>();

  constructor(
    private readonly bus: EventBus,
    private readonly delayMs = Number(process.env.MOCK_DELAY_MS ?? 1500),
  ) {}

  async run(req: AgentRequest): Promise<AgentResult> {
    const { role, taskId } = req;
    const emit = (e: Parameters<EventBus["emit"]>[0]) => this.bus.emit({ task: taskId, ...e });
    const usage = { in: Math.round(1200 + req.prompt.length / 4), out: 300, cached: 900, costUsd: 0 };

    emit({ type: "agent_state", agent: role.id, state: "thinking" });
    await sleep(this.delayMs);

    let result: AgentResult;
    if (role.id === "orchestrator") {
      const request = req.prompt.match(/Request:\s*(.+)/)?.[1]?.trim() ?? "feature";
      result = {
        text: "task card ready",
        structured: {
          title: request.slice(0, 60),
          assignee: /ui|page|button|หน้า/i.test(request) ? "frontend" : "backend",
          files: [],
          acceptance: [`${request} works`, "has a test"],
        },
        usage,
      };
    } else if (role.id === "reviewer") {
      emit({ type: "agent_state", agent: role.id, state: "reviewing" });
      await sleep(this.delayMs);
      const first = !this.reviewed.has(taskId);
      this.reviewed.add(taskId);
      result = {
        text: first ? "changes requested" : "approved",
        structured: first
          ? { verdict: "changes", comments: [{ file: "src/", comment: "Add a doc comment to the exported function." }] }
          : { verdict: "approve", comments: [] },
        usage,
      };
    } else {
      const slug = taskId.toLowerCase();
      const file = role.id === "frontend" ? `web/${slug}.js` : `src/${slug}.ts`;
      const retry = /Reviewer comments/.test(req.prompt);
      emit({ type: "agent_state", agent: role.id, state: "working" });
      emit({ type: "tool_call", agent: role.id, detail: `Read ${file}` });
      await sleep(this.delayMs);
      emit({ type: "tool_call", agent: role.id, detail: `${retry ? "Edit" : "Write"} ${file}` });
      const body = `${retry ? `/** Generated for ${taskId}. */\n` : ""}export function ${slug.replace(/-/g, "_")}() {\n  return "ok";\n}\n`;
      const path = join(req.cwd, file);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
      await sleep(this.delayMs);
      result = { text: `${retry ? "Updated" : "Created"} ${file}`, usage };
    }

    emit({ type: "message", agent: role.id, detail: result.text });
    emit({ type: "usage", agent: role.id, tokens: usage });
    emit({ type: "agent_state", agent: role.id, state: "idle" });
    return result;
  }
}
