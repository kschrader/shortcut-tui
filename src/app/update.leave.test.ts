import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { PullRequestId, StorySummary, WorkflowState, Workspace } from "../shortcut/types.ts";
import {
  codeReview,
  doing,
  finished,
  inState,
  ownedBy,
  readyForReview,
  storyId,
  summary,
  toDo,
  workflowState,
  workflowStates,
  workspaceFor,
} from "./fixtures.ts";
import type { Effect, Model, PullRequestView, StoryPullRequests } from "./model.ts";
import { pickerStates } from "./moves.ts";
import { shownStories } from "./rows.ts";
import { answer, browsing, first, ofType, only, submitQuery, type EffectOf } from "./steps.ts";
import { update } from "./update.ts";

const CONFIRMED_AT = new Date("2026-11-09T12:00:00Z");

const shownIds = (model: Model) => shownStories(model).map((story) => story.id);

const ids = (...numbers: number[]) => numbers.map(storyId);

const started = (id: number, owner: string, movedAt = new Date(id * 1000)): StorySummary => ({
  ...ownedBy(summary(id), owner),
  state: doing,
  pullRequestCount: 1,
  movedAt,
});

const mergedPullRequest: PullRequestView = {
  id: z.custom<PullRequestId>().parse(1),
  title: "Pull request 1",
  url: "https://github.com/acme/app/pull/1",
  closed: false,
  draft: false,
  github: { owner: "acme", repo: "app", number: 1 },
  state: "merged",
  reviews: null,
  optionalFailing: [],
};

const allMerged = (stories: readonly StorySummary[]): StoryPullRequests =>
  new Map(stories.map((story) => [story.id, { status: "loaded", value: [mergedPullRequest] }]));

const cycled = (model: Model, stories: readonly StorySummary[]): Model => {
  const [searching, effects] = update(model, { type: "filterCycled" });
  return answer(searching, only(effects, "searchStories"), stories)[0];
};

const mergedView = (stories: readonly StorySummary[]): Model => {
  const [mine] = browsing([]);
  const reviewing = cycled(mine, []);
  const [merging, effects] = update(reviewing, { type: "filterCycled" });
  const [found, foundEffects] = answer(merging, only(effects, "searchStories"), stories);
  const load = first(foundEffects, "loadPullRequests");
  return update(found, {
    type: "pullRequestsLoaded",
    requestId: load.requestId,
    pullRequests: allMerged(stories),
  })[0];
};

const selecting = (model: Model, id: number): Model =>
  update(model, { type: "storyClicked", storyId: storyId(id) })[0];

const pick = (model: Model, target: WorkflowState): [Model, EffectOf<"moveStory"> | null] => {
  const [open] = update(model, { type: "movePickerOpened" });
  const { focus } = open;
  if (focus.mode !== "picking" || open.workspace.status !== "loaded") {
    throw new Error(`picker did not open (focus ${focus.mode})`);
  }
  const story = shownStories(open).find((candidate) => candidate.id === focus.storyId);
  if (story === undefined) throw new Error("picker story is not shown");
  const index = pickerStates(open.workspace.value, story).findIndex(
    (state) => state.id === target.id,
  );
  const [moved] = update(open, { type: "movePickerMoved", delta: index - focus.cursor });
  const [confirmed, effects] = update(moved, { type: "movePickerConfirmed" });
  return [confirmed, ofType(effects, "moveStory")[0] ?? null];
};

const picked = (model: Model, target: WorkflowState): [Model, EffectOf<"moveStory">] => {
  const [confirmed, move] = pick(model, target);
  if (move === null) throw new Error("expected a moveStory effect");
  return [confirmed, move];
};

const storyIn = (model: Model, id: number): StorySummary => {
  const story =
    model.results.status === "loaded"
      ? model.results.value.stories.find((candidate) => candidate.id === storyId(id))
      : undefined;
  if (story === undefined) throw new Error(`story ${String(id)} is not in the results`);
  return story;
};

const confirm = (
  model: Model,
  move: EffectOf<"moveStory">,
  state: WorkflowState,
  movedAt = CONFIRMED_AT,
): [Model, Effect[]] =>
  update(model, {
    type: "moveSucceeded",
    requestId: move.requestId,
    storyId: move.storyId,
    story: { ...storyIn(model, move.storyId), state, updatedAt: movedAt, movedAt },
  });

const moveSelected = (model: Model, target: WorkflowState): [Model, Effect[]] => {
  const [saving, move] = picked(model, target);
  return confirm(saving, move, target);
};

const withWorkspace = (model: Model, workspace: Workspace): Model => ({
  ...model,
  workspace: { status: "loaded", value: workspace, reload: { status: "idle" } },
});

const ann1 = started(1, "Ann");
const ann2 = started(2, "Ann");
const zed3 = started(3, "Zed");

describe("a confirmed move in the merged, not moved view", () => {
  test("to a done state takes the row out and selects the row that took its place", () => {
    const model = selecting(mergedView([ann1, ann2, zed3]), 2);
    const [moved, effects] = moveSelected(model, finished);
    expect(shownIds(moved)).toEqual(ids(1, 3));
    expect(moved.selectedStoryId).toBe(storyId(3));
    expect(only(effects, "getStory").storyId).toBe(storyId(3));
  });

  test("from the last row selects the row above it", () => {
    const model = selecting(mergedView([ann1, ann2, zed3]), 3);
    const [moved] = moveSelected(model, finished);
    expect(shownIds(moved)).toEqual(ids(1, 2));
    expect(moved.selectedStoryId).toBe(storyId(2));
  });

  test("of the only row leaves an empty list with nothing selected", () => {
    const [moved, effects] = moveSelected(mergedView([ann1]), finished);
    expect(shownIds(moved)).toEqual([]);
    expect(moved.selectedStoryId).toBeNull();
    expect(effects).toEqual([]);
  });

  test("to another started state keeps the row selected", () => {
    const readyForDeploy = workflowState(6, "Ready for Deploy", "started", 2);
    const workspace = {
      ...workspaceFor("kurt"),
      workflowStates: [...workflowStates, readyForDeploy],
    };
    const model = selecting(withWorkspace(mergedView([ann1, ann2]), workspace), 1);
    const [moved] = moveSelected(model, readyForDeploy);
    expect(shownIds(moved)).toEqual(ids(2, 1));
    expect(moved.selectedStoryId).toBe(storyId(1));
  });

  test("keeps the row while it saves, and a failed move keeps it", () => {
    const [saving, move] = picked(mergedView([ann1, ann2]), finished);
    expect(shownIds(saving)).toEqual(ids(1, 2));
    expect(saving.moves.get(storyId(1))?.status).toBe("saving");
    const [failed] = update(saving, {
      type: "moveFailed",
      requestId: move.requestId,
      storyId: move.storyId,
      message: "Shortcut API 422",
    });
    expect(shownIds(failed)).toEqual(ids(1, 2));
    expect(failed.selectedStoryId).toBe(storyId(1));
  });

  test("leaves the selection where the user moved it while the move saved", () => {
    const [saving, move] = picked(mergedView([ann1, ann2, zed3]), finished);
    const elsewhere = selecting(saving, 3);
    const [moved, effects] = confirm(elsewhere, move, finished);
    expect(shownIds(moved)).toEqual(ids(2, 3));
    expect(moved.selectedStoryId).toBe(storyId(3));
    expect(effects).toEqual([]);
  });

  test("closes a picker reopened on the row while it saved", () => {
    const [saving, move] = picked(mergedView([ann1, ann2]), finished);
    const [reopened] = update(saving, { type: "movePickerOpened" });
    expect(reopened.focus.mode).toBe("picking");
    const [moved] = confirm(reopened, move, finished);
    expect(moved.focus).toEqual({ mode: "browsing" });
    expect(moved.selectedStoryId).toBe(storyId(2));
  });

  test("judges a chained re-move only on where it finally settles", () => {
    const [saving, firstMove] = picked(mergedView([ann1, ann2]), finished);
    const [rePicked, none] = pick(saving, doing);
    expect(none).toBeNull();
    const [chained, effects] = confirm(rePicked, firstMove, finished);
    const second = only(effects, "moveStory");
    expect(shownIds(chained)).toEqual(ids(2, 1));
    const [settled] = confirm(chained, second, doing);
    expect(shownIds(settled)).toEqual(ids(2, 1));
  });
});

const OLD = new Date("2026-09-01T09:00:00");

const longWaiting = [
  { ...inState(summary(1), doing), movedAt: OLD },
  { ...inState(summary(2), doing), movedAt: OLD },
];

const typedWithFloor = (stories: readonly StorySummary[]): Model => {
  const [mine] = browsing([]);
  const [flooring, floorEffects] = update(mine, {
    type: "ageFloorToggled",
    at: new Date("2026-11-09T09:00:00"),
  });
  const [floored] = answer(flooring, only(floorEffects, "searchStories"), []);
  const [typed, effects] = submitQuery(floored, "label:urgent");
  return answer(typed, only(effects, "searchStories"), stories)[0];
};

describe("a confirmed move in other views", () => {
  test("my started stories drops a story moved to done", () => {
    const [model] = browsing([inState(summary(1), doing), inState(summary(2), doing)]);
    const [moved] = moveSelected(model, finished);
    expect(shownIds(moved)).toEqual(ids(2));
    expect(moved.selectedStoryId).toBe(storyId(2));
  });

  test("a typed query keeps a story moved to done until the next search", () => {
    const [mine] = browsing([]);
    const [typed, effects] = submitQuery(mine, "label:urgent");
    const [model] = answer(typed, only(effects, "searchStories"), [inState(summary(1), doing)]);
    const [moved] = moveSelected(model, finished);
    expect(shownIds(moved)).toEqual(ids(1));
    expect(storyIn(moved, 1).state).toEqual(finished);
  });

  test("waiting for review drops a story moved out of review and keeps one moved between review states", () => {
    const secondReview = workflowState(7, "In Review", "started", 3, { id: 2, name: "Design" });
    const designDone = workflowState(8, "Shipped", "done", 4, { id: 2, name: "Design" });
    const workspace = {
      ...workspaceFor("kurt"),
      workflowStates: [...workflowStates, secondReview, designDone],
    };
    const [mine] = browsing([]);
    const reviewing = cycled(withWorkspace(mine, workspace), [
      ownedBy({ ...summary(1), state: readyForReview }, "Ann"),
      ownedBy({ ...summary(2), state: readyForReview }, "Ann"),
      ownedBy({ ...summary(3), state: codeReview }, "Zed"),
    ]);
    const [between] = moveSelected(reviewing, secondReview);
    expect(shownIds(between)).toContain(storyId(1));
    const [out] = moveSelected(selecting(between, 2), designDone);
    expect(shownIds(out)).not.toContain(storyId(2));
    expect(out.selectedStoryId).not.toBe(storyId(2));
  });

  test("with the age floor on, a move to any state takes the row out by the moved date Shortcut returns", () => {
    const model = typedWithFloor(longWaiting);
    const [saving, move] = picked(model, toDo);
    const [stillOld] = confirm(saving, move, toDo, OLD);
    expect(shownIds(stillOld)).toEqual(ids(2, 1));
    const [again, second] = picked(selecting(stillOld, 1), doing);
    const [moved] = confirm(again, second, doing);
    expect(shownIds(moved)).toEqual(ids(2));
  });
});

const refreshed = (model: Model, stories: readonly StorySummary[]): Model => {
  const [refreshing, effects] = update(model, { type: "refreshRequested" });
  return answer(refreshing, first(effects, "searchStories"), stories)[0];
};

describe("the refresh after a confirmed move", () => {
  test("changes nothing visible when its search no longer finds the story", () => {
    const [moved] = moveSelected(selecting(mergedView([ann1, ann2, zed3]), 2), finished);
    const after = refreshed(moved, [ann1, zed3]);
    expect(shownIds(after)).toEqual(shownIds(moved));
    expect(after.selectedStoryId).toBe(moved.selectedStoryId);
    expect(after.moves.size).toBe(0);
  });

  test("shows the story again when a search sent after the move still finds it", () => {
    const [model] = browsing([inState(summary(1), doing), inState(summary(2), doing)]);
    const [moved] = moveSelected(model, finished);
    const lagging = { ...inState(summary(1), doing), state: finished, movedAt: CONFIRMED_AT };
    const after = refreshed(moved, [lagging, inState(summary(2), doing)]);
    expect(shownIds(after)).toEqual(ids(1, 2));
    expect(after.selectedStoryId).toBe(storyId(2));
  });

  test("keeps the story out when a search sent before the move was confirmed lands after it", () => {
    const [saving, move] = picked(typedWithFloor(longWaiting), toDo);
    const [refreshing, effects] = update(saving, { type: "refreshRequested" });
    const [moved] = confirm(refreshing, move, toDo);
    expect(shownIds(moved)).toEqual(ids(2));
    const [stale] = answer(moved, first(effects, "searchStories"), longWaiting);
    expect(shownIds(stale)).toEqual(ids(2));
  });
});
