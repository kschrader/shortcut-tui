import type {
  MemberId,
  StorySummary,
  StoryType,
  Workspace,
  WorkflowStateId,
} from "../shortcut/types.ts";

export const fit = (text: string, width: number): string => {
  if (width <= 0) return "";
  const flat = text.replace(/\s+/g, " ");
  return flat.length <= width ? flat.padEnd(width) : `${flat.slice(0, width - 1)}…`;
};

export const typeStyle: Record<StoryType, { glyph: string; color: string }> = {
  feature: { glyph: "●", color: "#e5c07b" },
  bug: { glyph: "◆", color: "#e06c75" },
  chore: { glyph: "■", color: "#7aa2f7" },
};

export const stateName = (workspace: Workspace | null, id: WorkflowStateId): string =>
  workspace?.workflowStates.get(id)?.name ?? "…";

export const memberName = (workspace: Workspace | null, id: MemberId | null): string =>
  (id === null ? null : workspace?.members.get(id)?.name) ?? "Unknown";

export const ownerNames = (workspace: Workspace | null, story: StorySummary): string =>
  story.ownerIds.length === 0
    ? "Unassigned"
    : story.ownerIds.map((id) => memberName(workspace, id)).join(", ");

export const estimateLabel = (estimate: number | null): string =>
  estimate === null ? "–" : String(estimate);

export const dateLabel = (date: Date): string => date.toISOString().slice(0, 10);

export const storyCount = (count: number): string =>
  `${count} ${count === 1 ? "story" : "stories"}`;
