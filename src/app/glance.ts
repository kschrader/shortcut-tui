import { storyMergeStatus, type StoryMergeStatus } from "../github/pull-request-state.ts";
import type { StoryId, StorySummary } from "../shortcut/types.ts";
import type { Cached, Change, Glance, Model, StoryPullRequests } from "./model.ts";
import { shownStories } from "./rows.ts";

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

const searchedStories = (model: Model): readonly StorySummary[] =>
  model.results.status === "loaded" ? model.results.value.stories : [];

const selectedStory = (model: Model): StorySummary | null =>
  searchedStories(model).find((story) => story.id === model.selectedStoryId) ?? null;

export const changesOf = (model: Model, storyId: StoryId): readonly Change[] => {
  const story = shownStories(model).find((candidate) => candidate.id === storyId);
  if (story === undefined) return [];
  return changesBetween(model.seen.get(storyId), glanceOf(story, model.pullRequests));
};

export const unseenChanges = (model: Model): ReadonlyMap<StoryId, readonly Change[]> =>
  new Map(
    shownStories(model)
      .filter((story) => story.id !== model.selectedStoryId)
      .map((story) => [story.id, changesOf(model, story.id)] as const)
      .filter(([, changes]) => changes.length > 0),
  );

const answersNewQuestion = (before: Model, after: Model): boolean =>
  after.results.status === "loaded" &&
  after.results.value.cachedAt === null &&
  (before.results.status === "firstLoad" ||
    (before.results.status === "loaded" && before.results.value.cachedAt !== null));

export const noticed = (before: Model, after: Model): Model["seen"] => {
  const seen = new Map(after.seen);
  const now = (story: StorySummary) => glanceOf(story, after.pullRequests);
  if (answersNewQuestion(before, after)) {
    for (const story of searchedStories(after)) seen.set(story.id, now(story));
    return seen;
  }
  const left = selectedStory(before);
  if (left !== null && selectedStory(after)?.id !== left.id) {
    const glance = glanceOf(left, before.pullRequests);
    const mergeStatus = glance.mergeStatus ?? seen.get(left.id)?.mergeStatus ?? null;
    seen.set(left.id, { ...glance, mergeStatus });
  }
  for (const story of searchedStories(after)) {
    const record = seen.get(story.id);
    const glance = now(story);
    if (after.moves.has(story.id)) {
      seen.set(story.id, { ...glance, mergeStatus: record?.mergeStatus ?? glance.mergeStatus });
    } else if (record?.mergeStatus === null && glance.mergeStatus !== null) {
      seen.set(story.id, { ...record, mergeStatus: glance.mergeStatus });
    }
  }
  return seen;
};
