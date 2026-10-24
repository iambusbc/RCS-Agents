import type { Role } from "../config/roles.ts";
import type { TokenUsage } from "../events.ts";

export interface AgentRequest {
  role: Role;
  taskId: string;
  prompt: string;
  /** Working directory: the agent's own worktree. */
  cwd: string;
  /** JSON schema for a structured answer (reviewer verdicts, task cards). */
  outputSchema?: Record<string, unknown>;
}

export interface AgentResult {
  text: string;
  structured?: unknown;
  usage: TokenUsage;
}

/** Anything that can play a role: the real Claude agent or the token-free mock. */
export interface AgentRunner {
  run(req: AgentRequest): Promise<AgentResult>;
}

export const ZERO_USAGE: TokenUsage = { in: 0, out: 0, cached: 0, costUsd: 0 };
