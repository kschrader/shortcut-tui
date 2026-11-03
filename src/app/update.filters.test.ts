import { describe, expect, test } from "bun:test";
import { queryQuestion } from "./filters.ts";
import { summary, workspaceFor } from "./fixtures.ts";
import type { Model, Msg } from "./model.ts";
import { awaited } from "./remote.ts";
import { answer, browsing, first, myStartedQuery, only, submitQuery } from "./steps.ts";
import { init, update } from "./update.ts";

const cycle: Msg = { type: "filterCycled" };

const reviewQueries = ["state:4 !owner:kurt !is:archived", "state:5 !owner:kurt !is:archived"];

const reviewing = (): Model => {
  const [model] = browsing([summary(1)]);
  const [cycled, effects] = update(model, cycle);
  const [shown] = answer(cycled, only(effects, "searchStories"), [summary(2), summary(3)]);
  return shown;
};

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
});
