import { expect, test } from "bun:test";
import { z } from "zod";
import type { PullRequestState } from "../github/types.ts";
import type { PullRequestId, StoryId, StorySummary } from "../shortcut/types.ts";
import { storyId, summary } from "./fixtures.ts";
import type { Model, PullRequestView, StoryPullRequests } from "./model.ts";
import {
  answer,
  browsing,
  first,
  loggedIn,
  ofType,
  only,
  submitQuery,
  type EffectOf,
} from "./steps.ts";
import { update } from "./update.ts";

const linking = (id: number, pullRequestCount: number): StorySummary => ({
  ...summary(id),
  pullRequestCount,
});

const view = (number: number, state: PullRequestState): PullRequestView => ({
  id: z.custom<PullRequestId>().parse(number),
  title: `Pull request ${String(number)}`,
  url: `https://github.com/acme/app/pull/${String(number)}`,
  closed: false,
  draft: false,
  github: { owner: "acme", repo: "app", number },
  state,
});

const statuses = (entries: [number, PullRequestView[]][]): StoryPullRequests =>
  new Map(entries.map(([id, views]): [StoryId, PullRequestView[]] => [storyId(id), views]));

const deliver = (
  model: Model,
  load: EffectOf<"loadPullRequests">,
  pullRequests: StoryPullRequests,
) => update(model, { type: "pullRequestsLoaded", requestId: load.requestId, pullRequests });

const results = [linking(1, 2), summary(2), linking(3, 1)];

test("search results ask for the pull requests of exactly the stories that link some", () => {
  const [model, effects] = browsing(results);
  const load = first(effects, "loadPullRequests");
  expect(ofType(effects, "loadPullRequests").length).toBe(1);
  expect(load.storyIds).toEqual([storyId(1), storyId(3)]);
  expect(model.pullRequests).toEqual({ status: "loading", requestId: load.requestId });
});

test("results that link no pull requests ask for nothing and show none", () => {
  const [model, effects] = browsing([summary(1), summary(2)]);
  only(effects, "getStory");
  expect(model.pullRequests).toEqual({ status: "loaded", value: new Map() });
});

test("loaded pull requests are shown, and a duplicate delivery changes nothing", () => {
  const [model, effects] = browsing(results);
  const load = first(effects, "loadPullRequests");
  const loaded = statuses([
    [1, [view(10, "ready"), view(11, "merged")]],
    [3, [view(12, "conflicts")]],
  ]);
  const [shown] = deliver(model, load, loaded);
  expect(shown.pullRequests).toEqual({ status: "loaded", value: loaded });
  expect(deliver(shown, load, statuses([[1, [view(10, "closed")]]]))).toEqual([shown, []]);
});

test("a failed load is shown with its message", () => {
  const [model, effects] = browsing(results);
  const load = first(effects, "loadPullRequests");
  const [failed] = update(model, {
    type: "pullRequestsFailed",
    requestId: load.requestId,
    message: "GitHub status needs the gh CLI: gh auth login",
  });
  expect(failed.pullRequests).toEqual({
    status: "failed",
    message: "GitHub status needs the gh CLI: gh auth login",
  });
});

test("refresh asks again once the results reload, and drops the older answer", () => {
  const [model, effects] = browsing(results);
  const older = first(effects, "loadPullRequests");
  const [refreshing, refreshEffects] = update(model, { type: "refreshRequested" });
  expect(refreshing.pullRequests).toEqual({ status: "loaded", value: new Map() });
  const [reloaded, reloadEffects] = answer(
    refreshing,
    first(refreshEffects, "searchStories"),
    results,
  );
  const newer = first(reloadEffects, "loadPullRequests");
  expect(newer.requestId).not.toBe(older.requestId);
  const [afterLate] = deliver(reloaded, older, statuses([[1, [view(10, "merged")]]]));
  expect(afterLate.pullRequests).toEqual({ status: "loading", requestId: newer.requestId });
  const [afterLateFailure] = update(reloaded, {
    type: "pullRequestsFailed",
    requestId: older.requestId,
    message: "stale",
  });
  expect(afterLateFailure).toEqual(reloaded);
});

test("an answer for the previous query never lands on the new query's stories", () => {
  const [model, effects] = browsing(results);
  const load = first(effects, "loadPullRequests");
  const [searching] = submitQuery(model, "label:other");
  const [after] = deliver(searching, load, statuses([[1, [view(10, "ready")]]]));
  expect(after.pullRequests).toEqual({ status: "loaded", value: new Map() });
});

test("the workspace's first search also checks pull requests", () => {
  const [model, search] = loggedIn();
  const [, effects] = answer(model, search, [linking(5, 3)]);
  expect(first(effects, "loadPullRequests").storyIds).toEqual([storyId(5)]);
});
