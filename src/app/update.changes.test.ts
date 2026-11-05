import { expect, test } from "bun:test";
import { z } from "zod";
import type { PullRequestState } from "../github/types.ts";
import type { PullRequestId, StorySummary } from "../shortcut/types.ts";
import { doing, finished, inState, storyId, summary } from "./fixtures.ts";
import { changesOf, unseenChanges } from "./glance.ts";
import type { Change, Effect, Model, PullRequestView, StoryPullRequests } from "./model.ts";
import { answer, browsing, first, only } from "./steps.ts";
import { update } from "./update.ts";

const at = (seconds: number) => new Date(1_000 * seconds);

const refreshed = (model: Model, stories: readonly StorySummary[]): [Model, Effect[]] => {
  const [refreshing, effects] = update(model, { type: "refreshRequested" });
  return answer(refreshing, first(effects, "searchStories"), stories);
};

const marks = (model: Model): Record<number, readonly Change[]> =>
  Object.fromEntries([...unseenChanges(model)].map(([id, changes]) => [id, changes]));

const select = (model: Model, id: number): Model => {
  const [selected] = update(model, { type: "storyClicked", storyId: storyId(id) });
  expect(selected.selectedStoryId).toBe(storyId(id));
  return selected;
};

const view = (number: number, state: PullRequestState): PullRequestView => ({
  id: z.custom<PullRequestId>().parse(number),
  title: `Pull request ${String(number)}`,
  url: `https://github.com/acme/app/pull/${String(number)}`,
  closed: false,
  draft: false,
  github: { owner: "acme", repo: "app", number },
  state,
  reviews: null,
  optionalFailing: [],
});

const statusOf = (id: number, state: PullRequestState): StoryPullRequests =>
  new Map([[storyId(id), { status: "loaded", value: [view(id, state)] }]]);

const prsLoaded = (step: [Model, Effect[]], pullRequests: StoryPullRequests): Model => {
  const [model, effects] = step;
  const load = first(effects, "loadPullRequests");
  return update(model, { type: "pullRequestsLoaded", requestId: load.requestId, pullRequests })[0];
};

const linked = (id: number, updatedAt = at(0)): StorySummary => ({
  ...summary(id),
  pullRequestCount: 1,
  updatedAt,
});

const one = summary(1);
const two = summary(2);
const three = summary(3);

test("the first results for a question mark nothing", () => {
  const [model] = browsing([one, two, three]);
  expect(marks(model)).toEqual({});
  expect(changesOf(model, storyId(1))).toEqual([]);
});

test("a refresh that moved a story marks its state change", () => {
  const [model] = browsing([one, two, three]);
  const moved = inState(two, doing, at(5));
  const [after] = refreshed(select(model, 1), [one, moved, three]);
  expect(marks(after)).toEqual({ 2: [{ kind: "state", from: two.state, to: moved.state }] });
});

test("a story that joined the list on a refresh is new", () => {
  const [model] = browsing([one, two]);
  const [after] = refreshed(model, [one, two, three]);
  expect(marks(after)).toEqual({ 3: [{ kind: "new" }] });
});

test("a refresh where only updatedAt advanced marks an edit", () => {
  const [model] = browsing([one, two]);
  const [after] = refreshed(model, [one, { ...two, name: "Renamed", updatedAt: at(9) }]);
  expect(marks(after)).toEqual({ 2: [{ kind: "edited" }] });
});

test("a merge status change is marked once both the seen and the new status are known", () => {
  const story = linked(2);
  const opened = browsing([one, story]);
  const known = prsLoaded(opened, statusOf(2, "checks-running"));
  const reloading = refreshed(known, [one, story]);
  expect(marks(reloading[0])).toEqual({});
  const after = prsLoaded(reloading, statusOf(2, "ready"));
  expect(marks(after)).toEqual({
    2: [{ kind: "pullRequests", from: "checks-running", to: "ready" }],
  });
});

test("a merge status first learned after a failed load is a baseline, not a change", () => {
  const story = linked(2);
  const [model, effects] = browsing([one, story]);
  const [failed] = update(model, {
    type: "pullRequestsFailed",
    requestId: first(effects, "loadPullRequests").requestId,
    message: "gh auth login",
  });
  const learned = prsLoaded(refreshed(failed, [one, story]), statusOf(2, "draft"));
  expect(marks(learned)).toEqual({});
  const after = prsLoaded(refreshed(learned, [one, story]), statusOf(2, "needs-review"));
  expect(marks(after)).toEqual({
    2: [{ kind: "pullRequests", from: "draft", to: "needs-review" }],
  });
});

test("selecting a marked story takes its row mark, keeps the change for the detail pane, and leaving clears it", () => {
  const [model] = browsing([one, two]);
  const moved = inState(two, doing, at(5));
  const [after] = refreshed(model, [one, moved]);
  const change: Change = { kind: "state", from: two.state, to: moved.state };
  const looking = select(after, 2);
  expect(marks(looking)).toEqual({});
  expect(changesOf(looking, storyId(2))).toEqual([change]);
  const left = select(looking, 1);
  expect(marks(left)).toEqual({});
  expect(changesOf(left, storyId(2))).toEqual([]);
});

test("a change that arrives while you look at a story shows in its detail and is seen once you leave", () => {
  const [model] = browsing([one, two]);
  const looking = select(model, 2);
  const renamed = { ...two, name: "Renamed", updatedAt: at(5) };
  const [after] = refreshed(looking, [one, renamed]);
  expect(marks(after)).toEqual({});
  expect(changesOf(after, storyId(2))).toEqual([{ kind: "edited" }]);
  const left = select(after, 1);
  expect(marks(left)).toEqual({});
  const [again] = refreshed(left, [one, renamed]);
  expect(marks(again)).toEqual({});
});

test("a looked-at story that drops out of the list is remembered as you last saw it", () => {
  const [model] = browsing([one, two]);
  const renamed = { ...two, name: "Renamed", updatedAt: at(5) };
  const [looked] = refreshed(select(model, 2), [one, renamed]);
  const [gone] = refreshed(looked, [one]);
  expect(gone.selectedStoryId).toBe(storyId(1));
  const [back] = refreshed(gone, [one, renamed]);
  expect(marks(back)).toEqual({});
});

test("your own move is not a change, whether you stay on the story or leave before it saves", () => {
  const [model] = browsing([one, two]);
  const [open] = update(select(model, 2), { type: "movePickerOpened" });
  const [moved] = update(open, { type: "movePickerMoved", delta: 1 });
  const [saving, effects] = update(moved, { type: "movePickerConfirmed" });
  const move = only(effects, "moveStory");
  const left = select(saving, 1);
  expect(marks(left)).toEqual({});
  const serverStory = { ...two, state: doing, updatedAt: at(7) };
  const [saved] = update(left, {
    type: "moveSucceeded",
    requestId: move.requestId,
    storyId: move.storyId,
    story: serverStory,
  });
  expect(marks(saved)).toEqual({});
  const [after] = refreshed(saved, [one, serverStory]);
  expect(marks(after)).toEqual({});
  const [later] = refreshed(after, [one, inState(serverStory, finished, at(9))]);
  expect(marks(later)).toEqual({
    2: [{ kind: "state", from: serverStory.state, to: finished }],
  });
});

test("switching to another filter and back marks nothing that is unchanged", () => {
  const [model] = browsing([one, two]);
  const [review, reviewEffects] = update(model, { type: "filterCycled" });
  const [reviewing] = answer(review, first(reviewEffects, "searchStories"), [three]);
  expect(marks(reviewing)).toEqual({});
  const [mine, mineEffects] = update(reviewing, { type: "filterCycled" });
  const [back] = answer(mine, first(mineEffects, "searchStories"), [one, two]);
  expect(marks(back)).toEqual({});
});
