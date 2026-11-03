import { storyMergeStatus, type StoryMergeStatus } from "../github/pull-request-state.ts";
import type { StorySummary } from "../shortcut/types.ts";
import type { Cached, Change, Glance, StoryPullRequests } from "./model.ts";

const mergeStatusOf = (
  story: StorySummary,
  pullRequests: Cached<StoryPullRequests>,
): StoryMergeStatus | null => {
  if (story.pullRequestCount === 0) return "none";
  const list = pullRequests.value.get(story.id);
  if (list?.status !== "loaded") return null;
  const status = storyMergeStatus(list.value.map((pullRequest) => pullRequest.state));
  return status === "unknown" ? null : status;
};

export const glanceOf = (story: StorySummary, pullRequests: Cached<StoryPullRequests>): Glance => ({
  state: story.state,
  updatedAt: story.updatedAt,
  mergeStatus: mergeStatusOf(story, pullRequests),
});

export const changesBetween = (seen: Glance | undefined, now: Glance): readonly Change[] => {
  if (seen === undefined) return [{ kind: "new" }];
  const changes: Change[] = [];
  if (seen.state.id !== now.state.id) {
    changes.push({ kind: "state", from: seen.state, to: now.state });
  }
  if (
    seen.mergeStatus !== null &&
    now.mergeStatus !== null &&
    seen.mergeStatus !== now.mergeStatus
  ) {
    changes.push({ kind: "pullRequests", from: seen.mergeStatus, to: now.mergeStatus });
  }
  if (changes.length === 0 && now.updatedAt.getTime() > seen.updatedAt.getTime()) {
    changes.push({ kind: "edited" });
  }
  return changes;
};
