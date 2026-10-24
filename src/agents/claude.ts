import { query } from "@anthropic-ai/claude-agent-sdk";
import type { EventBus, TokenUsage } from "../events.ts";
import type { AgentRequest, AgentResult, AgentRunner } from "./types.ts";

/** Pull the one argument worth showing in the UI out of a tool call. */
function describeToolInput(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const target = i.file_path ?? i.path ?? i.pattern ?? i.command ?? "";
  return `${name} ${String(target)}`.trim().slice(0, 160);
}

/**
 * Runs one role through the Claude Agent SDK and mirrors what it does onto
 * the event bus. Token-saving choices live here:
 * - a short custom system prompt instead of the full default one, identical
 *   across runs of the same role so the prefix is cached;
 * - only the tools the role needs (fewer tool definitions in the prompt);
 * - no user/project settings loaded (`settingSources: []`);
 * - a hard `maxTurns` cap per role.
 */
export class ClaudeAgentRunner implements AgentRunner {
  constructor(private readonly bus: EventBus) {}

  async run(req: AgentRequest): Promise<AgentResult> {
    const { role, taskId } = req;
    const emit = (e: Parameters<EventBus["emit"]>[0]) => this.bus.emit({ task: taskId, ...e });

    emit({ type: "agent_state", agent: role.id, state: "thinking" });

    let text = "";
    let structured: unknown;
    let usage: TokenUsage = { in: 0, out: 0, cached: 0, costUsd: 0 };

    const stream = query({
      prompt: req.prompt,
      options: {
        model: role.model,
        cwd: req.cwd,
        systemPrompt: role.systemPrompt,
        tools: role.tools,
        allowedTools: role.tools,
        maxTurns: role.maxTurns,
        permissionMode: "acceptEdits",
        settingSources: [],
        ...(req.outputSchema ? { outputFormat: { type: "json_schema" as const, schema: req.outputSchema } } : {}),
      },
    });

    for await (const msg of stream) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "tool_use") {
            emit({ type: "agent_state", agent: role.id, state: "working" });
            emit({ type: "tool_call", agent: role.id, detail: describeToolInput(block.name, block.input) });
          } else if (block.type === "text" && block.text.trim()) {
            emit({ type: "message", agent: role.id, detail: block.text.trim().slice(0, 200) });
          }
        }
      } else if (msg.type === "result") {
        for (const m of Object.values(msg.modelUsage)) {
          usage = {
            in: usage.in + m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens,
            out: usage.out + m.outputTokens,
            cached: usage.cached + m.cacheReadInputTokens,
            costUsd: usage.costUsd + m.costUSD,
          };
        }
        if (msg.subtype === "success") {
          text = msg.result;
          structured = msg.structured_output;
        } else {
          emit({ type: "agent_state", agent: role.id, state: "error", detail: msg.subtype });
          emit({ type: "usage", agent: role.id, tokens: usage });
          throw new Error(`${role.id} stopped: ${msg.subtype}`);
        }
      }
    }

    emit({ type: "usage", agent: role.id, tokens: usage });
    emit({ type: "agent_state", agent: role.id, state: "idle" });
    return { text, structured, usage };
  }
}
