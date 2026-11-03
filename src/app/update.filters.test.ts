import { describe, expect, test } from "bun:test";
import { queryQuestion } from "./filters.ts";
import type { StorySummary } from "../shortcut/types.ts";
import { doing, finished, inState, ownedBy, summary, workspaceFor } from "./fixtures.ts";
import type { Model, Msg } from "./model.ts";
import { awaited } from "./remote.ts";
import { answer, browsing, first, myStartedQuery, only, submitQuery } from "./steps.ts";
import { init, update } from "./update.ts";

const cycle: Msg = { type: "filterCycled" };

const reviewQueries = ["state:4 !owner:kurt !is:archived", "state:5 !owner:kurt !is:archived"];

const reviewing = (stories: readonly StorySummary[] = [summary(2), summary(3)]): Model => {
  const [model] = browsing([summary(1)]);
  const [cycled, effects] = update(model, cycle);
  const [shown] = answer(cycled, only(effects, "searchStories"), stories);
  return shown;
};

const shownIds = (model: Model) =>
  model.results.status === "loaded" ? model.results.value.stories.map((story) => story.id) : [];

const ids = (...stories: StorySummary[]) => stories.map((story) => story.id);

const steps = (model: Model, msgs: readonly Msg[]): Model =>
  msgs.reduce((current, msg) => update(current, msg)[0], model);

const zedToDo = ownedBy(summary(11), "Zed");
const annDoing = ownedBy(inState(summary(12), doing), "Ann");

const finishSecondStory: Msg[] = [
  { type: "selectionMoved", delta: 1 },
  { type: "movePickerOpened" },
  { type: "movePickerMoved", delta: 2 },
  { type: "movePickerConfirmed" },
];

describe("filterCycled", () => {
  test("from my stories it searches every review state for stories I do not own", () => {
    const [model] = browsing([summary(1)]);
    const [cycled, effects] = update(model, cycle);
    expect(only(effects, "searchStories").queries).toEqual(reviewQueries);
    expect(cycled.question).toEqual({ kind: "inReview" });
    expect(cycled.results.status).toBe("firstLoad");
  });

  test("the review answer replaces the list and selects its first story", () => {
    const model = reviewing();
    expect(model.results.status === "loaded" ? model.results.value.stories : []).toEqual([
      summary(2),
      summary(3),
    ]);
    expect(model.selectedStoryId).toBe(summary(2).id);
  });

  test("from the review view it returns to my started stories", () => {
    const [cycled, effects] = update(reviewing(), cycle);
    expect(only(effects, "searchStories").queries).toEqual([myStartedQuery]);
    expect(cycled.question).toEqual(queryQuestion(myStartedQuery));
  });

  test("from a typed query it starts over at the first filter", () => {
    const [model] = browsing([summary(1)]);
    const [custom, customEffects] = submitQuery(model, "label:urgent");
    const [shown] = answer(custom, only(customEffects, "searchStories"), [summary(4)]);
    const [cycled, effects] = update(shown, cycle);
    expect(only(effects, "searchStories").queries).toEqual([myStartedQuery]);
    expect(cycled.question).toEqual(queryQuestion(myStartedQuery));
  });

  test("typing the default query by hand counts as my stories, so f goes to review", () => {
    const [, effects] = update(submitQuery(reviewing(), myStartedQuery)[0], cycle);
    expect(only(effects, "searchStories").queries).toEqual(reviewQueries);
  });

  test("does nothing before the workspace loads", () => {
    const [model] = init();
    expect(update(model, cycle)).toEqual([model, []]);
  });

  test.each<[string, Msg[]]>([
    ["editing the query", [{ type: "queryEditStarted" }]],
    ["reading help", [{ type: "helpOpened" }]],
    ["picking a state", [{ type: "movePickerOpened" }]],
  ])("does nothing while %s", (_, msgs) => {
    const [start] = browsing([summary(1)]);
    const model = msgs.reduce((current, msg) => update(current, msg)[0], start);
    expect(model.focus.mode).not.toBe("browsing");
    expect(update(model, cycle)).toEqual([model, []]);
  });

  test("a workspace without review states answers no stories without asking Shortcut", () => {
    const [initial, initEffects] = init();
    const [model] = update(initial, {
      type: "workspaceLoaded",
      requestId: only(initEffects, "loadWorkspace").requestId,
      workspace: { ...workspaceFor("kurt"), workflowStates: [] },
    });
    const [, effects] = update(model, cycle);
    expect(only(effects, "searchStories").queries).toEqual([]);
  });
});

describe("the review view", () => {
  test("/ starts with an empty draft", () => {
    const [editing] = update(reviewing(), { type: "queryEditStarted" });
    expect(editing.focus).toEqual({ mode: "editingQuery", draft: "" });
  });

  test.each<[string, Msg]>([
    ["r", { type: "refreshRequested" }],
    ["the auto-refresh", { type: "autoRefreshDue" }],
    ["a stale terminal focus", { type: "terminalFocused", at: new Date("2026-11-03T00:00:00Z") }],
  ])("%s refetches the review states and keeps the list on screen", (_, msg) => {
    const model = reviewing();
    const [refreshing, effects] = update(model, msg);
    expect(first(effects, "searchStories").queries).toEqual(reviewQueries);
    expect(refreshing.question).toEqual({ kind: "inReview" });
    expect(refreshing.results.status).toBe("loaded");
    expect(awaited(refreshing.results)).not.toBeNull();
  });

  test("groups stories by owner, furthest along first within each owner", () => {
    const boDoing = ownedBy(inState(summary(21), doing), "Bo");
    const annToDo = ownedBy(summary(22), "Ann");
    const annDone = ownedBy(inState(summary(23), finished), "Ann");
    const model = reviewing([boDoing, annToDo, annDone]);
    expect(shownIds(model)).toEqual(ids(annDone, annToDo, boDoing));
  });

  test("j from one engineer's last story goes to the next engineer's first", () => {
    const boDoing = ownedBy(inState(summary(21), doing), "Bo");
    const annToDo = ownedBy(summary(22), "Ann");
    const annDone = ownedBy(inState(summary(23), finished), "Ann");
    const model = steps(reviewing([boDoing, annToDo, annDone]), [
      { type: "selectionMoved", delta: 1 },
    ]);
    expect(model.selectedStoryId).toBe(annToDo.id);
    expect(steps(model, [{ type: "selectionMoved", delta: 1 }]).selectedStoryId).toBe(boDoing.id);
  });

  test("a move keeps the story under its owner", () => {
    const model = reviewing([zedToDo, annDoing]);
    expect(shownIds(model)).toEqual(ids(annDoing, zedToDo));
    const moved = steps(model, finishSecondStory);
    expect(
      moved.results.status === "loaded" ? moved.results.value.stories[1]?.state : null,
    ).toEqual(finished);
    expect(shownIds(moved)).toEqual(ids(annDoing, zedToDo));
  });
});

describe("my stories", () => {
  test("a move reorders by state, not by owner", () => {
    const [model] = browsing([zedToDo, annDoing]);
    expect(shownIds(model)).toEqual(ids(annDoing, zedToDo));
    expect(shownIds(steps(model, finishSecondStory))).toEqual(ids(zedToDo, annDoing));
  });
});
