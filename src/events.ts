import { EventEmitter } from "node:events";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type AgentState =
  | "idle"
  | "thinking"
  | "working"
  | "reviewing"
  | "blocked"
  | "done"
  | "error";

export type EventType =
  | "task_created"
  | "agent_state"
  | "tool_call"
  | "message"
  | "commit"
  | "pr_opened"
  | "review"
  | "tests"
  | "merged"
  | "usage"
  | "task_done"
  | "task_failed";

export interface TokenUsage {
  in: number;
  out: number;
  cached: number;
  costUsd: number;
}

/** One line on the bus. Kept small: the 3D UI only needs enough to animate. */
export interface AgentEvent {
  ts: string;
  type: EventType;
  agent: string;
  task?: string;
  state?: AgentState;
  detail?: string;
  tokens?: TokenUsage;
}

/**
 * In-process event bus with a ring buffer for late joiners and an optional
 * JSONL log for replay. Swap for Redis Streams/NATS when agents run in
 * separate processes; the event shape stays the same.
 */
export class EventBus {
  private emitter = new EventEmitter();
  private history: AgentEvent[] = [];

  constructor(
    private readonly logFile?: string,
    private readonly historySize = 500,
  ) {
    this.emitter.setMaxListeners(100);
    if (logFile) mkdirSync(dirname(logFile), { recursive: true });
  }

  emit(event: Omit<AgentEvent, "ts">): AgentEvent {
    const full: AgentEvent = { ts: new Date().toISOString(), ...event };
    this.history.push(full);
    if (this.history.length > this.historySize) this.history.shift();
    if (this.logFile) appendFileSync(this.logFile, JSON.stringify(full) + "\n");
    this.emitter.emit("event", full);
    return full;
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);
  }

  recent(): AgentEvent[] {
    return [...this.history];
  }
}
