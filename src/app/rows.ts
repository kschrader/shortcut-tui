import { storyMergeStatus } from "../github/pull-request-state.ts";
import type { StorySummary } from "../shortcut/types.ts";
import { showsOnlyMerged } from "./filters.ts";
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

export const rowsOf = (
  { question, stories }: SearchResults,
  pullRequests: Cached<StoryPullRequests>,
): Rows => {
  if (!showsOnlyMerged(question.view)) return { status: "shown", stories };
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
  const rows = rowsOf(model.results.value, model.pullRequests);
  return rows.status === "shown" ? rows.stories : [];
};
