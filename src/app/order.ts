import type { Progress, StorySummary } from "../shortcut/types.ts";
import type { Grouping } from "./filters.ts";

const progressRank: Record<Progress, number> = { unstarted: 0, started: 1, done: 2 };

const furthestAlongFirst = (a: StorySummary, b: StorySummary) =>
  progressRank[b.state.progress] - progressRank[a.state.progress] ||
  b.state.position - a.state.position ||
  a.state.workflow.name.localeCompare(b.state.workflow.name) ||
  a.state.id - b.state.id ||
  b.updatedAt.getTime() - a.updatedAt.getTime();

export const NO_OWNER = "No owner";

const byName = (a: string, b: string) => a.localeCompare(b);

export const ownerGroupLabel = (story: StorySummary): string =>
  story.owners.length === 0
    ? NO_OWNER
    : story.owners
        .map((owner) => owner.name)
        .toSorted(byName)
        .join(" + ");

const longestWaitingFirst = (a: StorySummary, b: StorySummary) =>
  a.movedAt.getTime() - b.movedAt.getTime();

const ownerGroupFirst = (a: StorySummary, b: StorySummary) => {
  const left = ownerGroupLabel(a);
  const right = ownerGroupLabel(b);
  return (
    Number(left === NO_OWNER) - Number(right === NO_OWNER) ||
    byName(left, right) ||
    longestWaitingFirst(a, b) ||
    furthestAlongFirst(a, b)
  );
};

export const orderFor = (grouping: Grouping): ((a: StorySummary, b: StorySummary) => number) => {
  switch (grouping) {
    case "state":
      return furthestAlongFirst;
    case "owner":
      return ownerGroupFirst;
  }
};
