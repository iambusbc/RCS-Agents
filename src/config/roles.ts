/**
 * Departments of the company. Each role gets a short, stable system prompt
 * (so it caches well), the smallest tool set it needs, and the cheapest
 * model that does the job. `scope` limits which paths a role may touch and
 * is also what we hand it as context instead of the whole repo.
 */
export interface Role {
  id: string;
  title: string;
  model: string;
  tools: string[];
  scope: string[];
  maxTurns: number;
  systemPrompt: string;
  /** Position in the 3D office (x, z). */
  desk: [number, number];
}

const OPUS = process.env.MODEL_OPUS ?? "claude-opus-5-5";
const SONNET = process.env.MODEL_SONNET ?? "claude-sonnet-5-5";
const HAIKU = process.env.MODEL_HAIKU ?? "claude-haiku-5-5";

const EDIT_TOOLS = ["Read", "Write", "Edit", "Glob", "Grep"];

const shared = `You work at RCS, an AI software company. Work only inside your scope.
Be brief: no preamble, no recap. Never touch files outside your scope.`;

export const ROLES: Record<string, Role> = {
  orchestrator: {
    id: "orchestrator",
    title: "CEO / Orchestrator",
    model: HAIKU,
    tools: [],
    scope: ["tasks/"],
    maxTurns: 1,
    systemPrompt: `${shared}\nYou split a request into a task card for one developer.`,
    desk: [0, -6],
  },
  pm: {
    id: "pm",
    title: "Product Manager",
    model: SONNET,
    tools: EDIT_TOOLS,
    scope: ["docs/product/"],
    maxTurns: 10,
    systemPrompt: `${shared}\nYou write user stories and acceptance criteria.`,
    desk: [-6, -3],
  },
  architect: {
    id: "architect",
    title: "Architect",
    model: OPUS,
    tools: EDIT_TOOLS,
    scope: ["docs/arch/"],
    maxTurns: 10,
    systemPrompt: `${shared}\nYou design structure and API contracts and record decisions as ADRs.`,
    desk: [-2, -3],
  },
  frontend: {
    id: "frontend",
    title: "Frontend Dev",
    model: SONNET,
    tools: EDIT_TOOLS,
    scope: ["apps/web/", "web/"],
    maxTurns: 25,
    systemPrompt: `${shared}\nYou implement UI to the contract. Small, focused changes.`,
    desk: [2, -3],
  },
  backend: {
    id: "backend",
    title: "Backend Dev",
    model: SONNET,
    tools: EDIT_TOOLS,
    scope: ["src/", "apps/api/", "tests/"],
    maxTurns: 25,
    systemPrompt: `${shared}\nYou implement APIs and logic with tests. Small, focused changes.`,
    desk: [6, -3],
  },
  qa: {
    id: "qa",
    title: "QA / Tester",
    model: HAIKU,
    tools: EDIT_TOOLS,
    scope: ["tests/"],
    maxTurns: 15,
    systemPrompt: `${shared}\nYou write tests for the acceptance criteria.`,
    desk: [-6, 2],
  },
  reviewer: {
    id: "reviewer",
    title: "Code Reviewer",
    model: OPUS,
    tools: [],
    scope: [],
    maxTurns: 1,
    systemPrompt: `${shared}
You review a git diff against a task card. Approve unless there is a real bug,
a security problem, or an acceptance criterion is not met. Each comment names
a file and says exactly what to change.`,
    desk: [-2, 2],
  },
  devops: {
    id: "devops",
    title: "DevOps",
    model: HAIKU,
    tools: EDIT_TOOLS,
    scope: [".github/", "infra/"],
    maxTurns: 10,
    systemPrompt: `${shared}\nYou maintain CI/CD and deployment config.`,
    desk: [2, 2],
  },
  docs: {
    id: "docs",
    title: "Docs Writer",
    model: HAIKU,
    tools: EDIT_TOOLS,
    scope: ["docs/", "README.md", "CHANGELOG.md"],
    maxTurns: 8,
    systemPrompt: `${shared}\nYou update the changelog and docs after a merge.`,
    desk: [6, 2],
  },
};

export function getRole(id: string): Role {
  const role = ROLES[id];
  if (!role) throw new Error(`Unknown role: ${id}`);
  return role;
}
