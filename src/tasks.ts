export interface TaskCard {
  id: string;
  title: string;
  request: string;
  assignee: "backend" | "frontend";
  files: string[];
  acceptance: string[];
}

/** Schema the orchestrator answers with, so the card needs no parsing guesswork. */
export const TASK_CARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "assignee", "files", "acceptance"],
  properties: {
    title: { type: "string", description: "Short imperative title" },
    assignee: { type: "string", enum: ["backend", "frontend"] },
    files: { type: "array", items: { type: "string" }, description: "Files likely to change" },
    acceptance: { type: "array", items: { type: "string" }, description: "2-5 checkable criteria" },
  },
} as const;

export const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "comments"],
  properties: {
    verdict: { type: "string", enum: ["approve", "changes"] },
    comments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file", "comment"],
        properties: { file: { type: "string" }, comment: { type: "string" } },
      },
    },
  },
} as const;

export interface Review {
  verdict: "approve" | "changes";
  comments: { file: string; comment: string }[];
}

/** The card is the whole handoff: agents get this, not the chat history. */
export function renderTaskCard(card: TaskCard): string {
  return [
    `# ${card.id}: ${card.title}`,
    "",
    `Assignee: ${card.assignee}`,
    "",
    "## Request",
    card.request,
    "",
    "## Files",
    ...(card.files.length ? card.files.map((f) => `- ${f}`) : ["- (decide)"]),
    "",
    "## Acceptance criteria",
    ...card.acceptance.map((a) => `- [ ] ${a}`),
    "",
  ].join("\n");
}

export function renderReviewComments(review: Review): string {
  return review.comments.map((c) => `- ${c.file}: ${c.comment}`).join("\n");
}
