import { storyMergeStatus } from "../github/pull-request-state.ts";
import type { StoryId, StorySummary } from "../shortcut/types.ts";
import { searchWouldFind, showsOnlyMerged } from "./filters.ts";
import type { Cached, Model, SearchResults, StoryPullRequests } from "./model.ts";

export type Rows =
  | { status: "shown"; stories: readonly StorySummary[] }
  | { status: "checking"; searched: number }
  | { status: "unchecked"; message: string };

const isMerged = (story: StorySummary, pullRequests: Cached<StoryPullRequests>): boolean => {
  const list = pullRequests.value.get(story.id);
  return (
    list?.status === "loaded" && storyMergeStatus(list.value.map((pr) => pr.state)) === "merged"
  );
};

const beforeAnyStatus = (
  pullRequests: Cached<StoryPullRequests>,
  searched: number,
): Rows | null => {
  const { reload } = pullRequests;
  switch (reload.status) {
    case "inFlight":
      return { status: "checking", searched };
    case "failed":
      return { status: "unchecked", message: reload.message };
    case "idle":
      return null;
  }
};

const leftAfterMove = (model: Model, results: SearchResults) => {
  if (model.workspace.status !== "loaded") return () => false;
  const wouldFind = searchWouldFind(results.question, model.workspace.value);
  return (story: StorySummary) =>
    model.moves.get(story.id)?.status === "moved" && !wouldFind(story);
};

export const rowsOf = (model: Model, results: SearchResults): Rows => {
  const left = leftAfterMove(model, results);
  const stories = results.stories.filter((story) => !left(story));
  const { pullRequests } = model;
  if (!showsOnlyMerged(results.question.view)) return { status: "shown", stories };
  const linking = stories.filter((story) => story.pullRequestCount > 0);
  const waiting = linking.some((story) => pullRequests.value.has(story.id))
    ? null
    : beforeAnyStatus(pullRequests, linking.length);
  return (
    waiting ?? {
      status: "shown",
      stories: stories.filter((story) => isMerged(story, pullRequests)),
    }
  );
};

export const shownStories = (model: Model): readonly StorySummary[] => {
  if (model.results.status !== "loaded") return [];
  const rows = rowsOf(model, model.results.value);
  return rows.status === "shown" ? rows.stories : [];
};

export const rowInPlaceOf = (
  before: readonly StorySummary[],
  after: readonly StorySummary[],
  storyId: StoryId,
): StoryId | null => {
  const index = before.findIndex((story) => story.id === storyId);
  const stillShown = (story: StorySummary) => after.some((shown) => shown.id === story.id);
  const next = before.slice(index + 1).find(stillShown);
  const previous = before.slice(0, Math.max(index, 0)).findLast(stillShown);
  return next?.id ?? previous?.id ?? after[0]?.id ?? null;
};
