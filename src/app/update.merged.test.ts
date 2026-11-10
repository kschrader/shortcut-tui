import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { PullRequestState } from "../github/types.ts";
import type { PullRequestId, StorySummary } from "../shortcut/types.ts";
import { ownedBy, storyId, summary } from "./fixtures.ts";
import type { Model, Msg, PullRequestView, Settled, StoryPullRequests } from "./model.ts";
import { rowsOf, shownStories } from "./rows.ts";
import { changesOf, unseenChanges } from "./glance.ts";
import { answer, browsing, first, ofType, only, type EffectOf } from "./steps.ts";
import { update } from "./update.ts";

const cycle: Msg = { type: "filterCycled" };

const linking = (id: number, owner: string, movedAt = new Date(id * 1000)): StorySummary => ({
  ...ownedBy(summary(id), owner),
  pullRequestCount: 1,
  movedAt,
});

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

const linked = (...states: PullRequestState[]): Settled<readonly PullRequestView[]> => ({
  status: "loaded",
  value: states.map((state, index) => view(index + 1, state)),
});

const statuses = (
  entries: readonly [number, Settled<readonly PullRequestView[]>][],
): StoryPullRequests => new Map(entries.map(([id, list]) => [storyId(id), list] as const));

const searchMerged = (): [Model, EffectOf<"searchStories">] => {
  const [mine] = browsing([summary(90)]);
  const [reviewing, reviewEffects] = update(mine, cycle);
  const [review] = answer(reviewing, only(reviewEffects, "searchStories"), []);
  const [merging, effects] = update(review, cycle);
  return [merging, only(effects, "searchStories")];
};

const found = (stories: readonly StorySummary[]): [Model, EffectOf<"loadPullRequests">] => {
  const [merging, search] = searchMerged();
  const [model, effects] = answer(merging, search, stories);
  const [load] = ofType(effects, "loadPullRequests");
  if (load === undefined) throw new Error("expected a loadPullRequests effect");
  return [model, load];
};

const deliver = (
  model: Model,
  load: EffectOf<"loadPullRequests">,
  pullRequests: StoryPullRequests,
) => update(model, { type: "pullRequestsLoaded", requestId: load.requestId, pullRequests });

const shownIds = (model: Model) => shownStories(model).map((story) => story.id);

const rowsStatus = (model: Model) =>
  model.results.status === "loaded" ? rowsOf(model, model.results.value) : null;

const ann1 = linking(1, "Ann", new Date(5_000));
const ann2 = linking(2, "Ann", new Date(1_000));
const zed3 = linking(3, "Zed");
const zed4 = linking(4, "Zed");
const ann5 = linking(5, "Ann");
const zed6 = linking(6, "Zed");

const everyKind = statuses([
  [1, linked("merged")],
  [2, linked("merged", "closed")],
  [3, linked("ready", "merged")],
  [4, linked("closed")],
  [5, linked("unknown")],
  [6, { status: "failed", message: "Shortcut API 500" }],
]);

describe("merged, not moved", () => {
  test("shows nothing and checks GitHub until the statuses arrive, without selecting a story", () => {
    const [model, load] = found([ann1, ann2, zed3]);
    expect(load.storyIds).toEqual([ann2.id, ann1.id, zed3.id]);
    expect(rowsStatus(model)).toEqual({ status: "checking", searched: 3 });
    expect(shownIds(model)).toEqual([]);
    expect(model.selectedStoryId).toBeNull();
  });

  test("shows only stories whose pull requests are all merged or closed with one merged, longest waiting first under each owner", () => {
    const [model, load] = found([ann1, ann2, zed3, zed4, ann5, zed6]);
    const [checked, effects] = deliver(model, load, everyKind);
    expect(shownIds(checked)).toEqual([ann2.id, ann1.id]);
    expect(checked.selectedStoryId).toBe(ann2.id);
    expect(only(effects, "getStory").storyId).toBe(ann2.id);
    expect(unseenChanges(checked).size).toBe(0);
  });

  test("says so when no pull request status could be loaded at all", () => {
    const [model, load] = found([ann1]);
    const [failed] = update(model, {
      type: "pullRequestsFailed",
      requestId: load.requestId,
      message: "gh: not logged in",
    });
    expect(rowsStatus(failed)).toEqual({ status: "unchecked", message: "gh: not logged in" });
    expect(failed.selectedStoryId).toBeNull();
  });

  test("results that link no pull requests show nothing without asking GitHub", () => {
    const [merging, search] = searchMerged();
    const [model, effects] = answer(merging, search, [summary(9)]);
    expect(effects).toEqual([]);
    expect(rowsStatus(model)).toEqual({ status: "shown", stories: [] });
    expect(model.selectedStoryId).toBeNull();
  });

  test("j and k walk only the shown stories and stop at their ends", () => {
    const [model, load] = found([ann1, ann2, zed3, zed4, linking(7, "Zed")]);
    const [checked] = deliver(
      model,
      load,
      statuses([
        [1, linked("closed")],
        [2, linked("merged")],
        [3, linked("ready")],
        [4, linked("checks-running")],
        [7, linked("merged")],
      ]),
    );
    const walk = (deltas: readonly number[]) =>
      deltas.map((delta) => {
        const [moved] = update(checked, { type: "selectionMoved", delta });
        return moved.selectedStoryId;
      });
    expect(checked.selectedStoryId).toBe(ann2.id);
    expect(walk([1, 2, -1])).toEqual([storyId(7), storyId(7), ann2.id]);
  });

  test("a click on a story the filter hides does nothing", () => {
    const [model, load] = found([ann1, ann2]);
    const [checked] = deliver(
      model,
      load,
      statuses([
        [1, linked("closed")],
        [2, linked("merged")],
      ]),
    );
    expect(update(checked, { type: "storyClicked", storyId: ann1.id })).toEqual([checked, []]);
  });

  test("a refresh keeps the shown rows and selection until GitHub answers, then follows the answer", () => {
    const [model, load] = found([ann1, ann2]);
    const [checked] = deliver(
      model,
      load,
      statuses([
        [1, linked("merged")],
        [2, linked("merged")],
      ]),
    );
    expect(checked.selectedStoryId).toBe(ann2.id);
    const [refreshing, refreshEffects] = update(checked, { type: "refreshRequested" });
    const [reloaded, reloadEffects] = answer(refreshing, first(refreshEffects, "searchStories"), [
      ann1,
      ann2,
    ]);
    expect(shownIds(reloaded)).toEqual([ann2.id, ann1.id]);
    expect(reloaded.selectedStoryId).toBe(ann2.id);
    const [answered, effects] = deliver(
      reloaded,
      only(reloadEffects, "loadPullRequests"),
      statuses([
        [1, linked("merged")],
        [2, linked("merged", "ready")],
      ]),
    );
    expect(shownIds(answered)).toEqual([ann1.id]);
    expect(answered.selectedStoryId).toBe(ann1.id);
    expect(ofType(effects, "getStory").map((effect) => effect.storyId)).toEqual([ann1.id]);
  });

  test("a refresh that finds the selected story with no pull requests left selects the next shown story at once", () => {
    const [model, load] = found([ann1, ann2]);
    const [checked] = deliver(
      model,
      load,
      statuses([
        [1, linked("merged")],
        [2, linked("merged")],
      ]),
    );
    const [refreshing, refreshEffects] = update(checked, { type: "refreshRequested" });
    const [reloaded] = answer(refreshing, first(refreshEffects, "searchStories"), [
      ann1,
      { ...ann2, pullRequestCount: 0 },
    ]);
    expect(shownIds(reloaded)).toEqual([ann1.id]);
    expect(reloaded.selectedStoryId).toBe(ann1.id);
  });

  test("the move picker closes when its story stops qualifying", () => {
    const [model, load] = found([ann1]);
    const [checked] = deliver(model, load, statuses([[1, linked("merged")]]));
    const [picking] = update(checked, { type: "movePickerOpened" });
    expect(picking.focus.mode).toBe("picking");
    const [refreshing, refreshEffects] = update(picking, { type: "refreshRequested" });
    expect(refreshing.focus.mode).toBe("browsing");
    const [reloaded, reloadEffects] = answer(refreshing, first(refreshEffects, "searchStories"), [
      ann1,
    ]);
    const [reopened] = update(reloaded, { type: "movePickerOpened" });
    const [answered] = deliver(
      reopened,
      only(reloadEffects, "loadPullRequests"),
      statuses([[1, linked("ready")]]),
    );
    expect(answered.focus).toEqual({ mode: "browsing" });
    expect(answered.selectedStoryId).toBeNull();
  });

  test("a story that turns merged after a refresh appears with its pull request change marked", () => {
    const [model, load] = found([ann1, ann2]);
    const [checked] = deliver(
      model,
      load,
      statuses([
        [1, linked("ready")],
        [2, linked("merged")],
      ]),
    );
    const [refreshing, refreshEffects] = update(checked, { type: "refreshRequested" });
    const [reloaded, reloadEffects] = answer(refreshing, first(refreshEffects, "searchStories"), [
      ann1,
      ann2,
    ]);
    const [answered] = deliver(
      reloaded,
      only(reloadEffects, "loadPullRequests"),
      statuses([
        [1, linked("merged")],
        [2, linked("merged")],
      ]),
    );
    expect(shownIds(answered)).toEqual([ann2.id, ann1.id]);
    expect(changesOf(answered, ann1.id)).toEqual([
      { kind: "pullRequests", from: "ready", to: "merged" },
    ]);
  });
});
