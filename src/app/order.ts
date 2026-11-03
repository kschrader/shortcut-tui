import type { Progress, StorySummary } from "../shortcut/types.ts";

const progressRank: Record<Progress, number> = { unstarted: 0, started: 1, done: 2 };

export const furthestAlongFirst = (a: StorySummary, b: StorySummary) =>
  progressRank[b.state.progress] - progressRank[a.state.progress] ||
  b.state.position - a.state.position ||
  a.state.workflow.name.localeCompare(b.state.workflow.name) ||
  a.state.id - b.state.id ||
  b.updatedAt.getTime() - a.updatedAt.getTime();
