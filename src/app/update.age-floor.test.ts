import { describe, expect, test } from "bun:test";
import { summary } from "./fixtures.ts";
import type { Model, Msg } from "./model.ts";
import { awaited } from "./remote.ts";
import { answer, browsing, first, myStartedQuery, only, submitQuery } from "./steps.ts";
import { init, update } from "./update.ts";

const toggle = (at = new Date("2026-11-04T12:00:00Z")): Msg => ({ type: "ageFloorToggled", at });

const reviewQueries = ["state:4 !owner:kurt !is:archived", "state:5 !owner:kurt !is:archived"];

const floored = (queries: readonly string[], day: string) =>
  queries.map((query) => `${query} moved:*..${day}`);

const flooredMine = (): Model => {
  const [model] = browsing([summary(1), summary(2)]);
  const [toggled, effects] = update(model, toggle());
  return answer(toggled, only(effects, "searchStories"), [summary(2)])[0];
};

describe("ageFloorToggled", () => {
  test("on from startup asks for the same stories moved into their state 4 weeks or more before", () => {
    const [model] = browsing([summary(1)]);
    const [toggled, effects] = update(model, toggle());
    expect(only(effects, "searchStories").queries).toEqual(floored([myStartedQuery], "2026-10-07"));
    expect(toggled.results.status).toBe("firstLoad");
  });

  test("the cutoff is the calendar day 28 days before the toggle", () => {
    const [model] = browsing([summary(1)]);
    const [, effects] = update(model, toggle(new Date("2026-03-30T12:00:00Z")));
    expect(only(effects, "searchStories").queries).toEqual(floored([myStartedQuery], "2026-03-02"));
  });

  test("off asks the plain question again", () => {
    const [toggledOff, effects] = update(flooredMine(), toggle(new Date("2026-11-20T12:00:00Z")));
    expect(only(effects, "searchStories").queries).toEqual([myStartedQuery]);
    expect(toggledOff.question.movedOnOrBefore).toBeNull();
    expect(toggledOff.results.status).toBe("firstLoad");
  });

  test("in the review view every per-state search carries the floor", () => {
    const [model] = browsing([summary(1)]);
    const [reviewing, reviewEffects] = update(model, { type: "filterCycled" });
    const [review] = answer(reviewing, only(reviewEffects, "searchStories"), [summary(3)]);
    const [, effects] = update(review, toggle());
    expect(only(effects, "searchStories").queries).toEqual(floored(reviewQueries, "2026-10-07"));
  });

  test("f keeps the floor through every filter", () => {
    const [reviewing, reviewEffects] = update(flooredMine(), { type: "filterCycled" });
    const reviewSearch = only(reviewEffects, "searchStories");
    expect(reviewSearch.queries).toEqual(floored(reviewQueries, "2026-10-07"));
    const [review] = answer(reviewing, reviewSearch, [summary(3)]);
    const [, mineEffects] = update(review, { type: "filterCycled" });
    expect(only(mineEffects, "searchStories").queries).toEqual(
      floored([myStartedQuery], "2026-10-07"),
    );
  });

  test("/ starts from the typed text and a submitted query keeps the floor", () => {
    const [editing] = update(flooredMine(), { type: "queryEditStarted" });
    expect(editing.focus).toEqual({ mode: "editingQuery", draft: `${myStartedQuery} ` });
    const [, effects] = submitQuery(flooredMine(), "label:urgent");
    expect(only(effects, "searchStories").queries).toEqual(["label:urgent moved:*..2026-10-07"]);
  });

  test("an empty query asks only for the floor", () => {
    const [, effects] = update(submitQuery(flooredMine(), "")[0], { type: "refreshRequested" });
    expect(first(effects, "searchStories").queries).toEqual(["moved:*..2026-10-07"]);
  });

  test("a refresh asks the same question again with the same cutoff and keeps the list", () => {
    const model = flooredMine();
    const [refreshing, effects] = update(model, { type: "refreshRequested" });
    expect(first(effects, "searchStories").queries).toEqual(
      floored([myStartedQuery], "2026-10-07"),
    );
    expect(refreshing.results.status).toBe("loaded");
    expect(awaited(refreshing.results)).not.toBeNull();
  });

  test("does nothing before the workspace loads", () => {
    const [model] = init();
    expect(update(model, toggle())).toEqual([model, []]);
  });

  test.each<[string, Msg[]]>([
    ["editing the query", [{ type: "queryEditStarted" }]],
    ["reading help", [{ type: "helpOpened" }]],
    ["picking a state", [{ type: "movePickerOpened" }]],
  ])("does nothing while %s", (_, msgs) => {
    const [start] = browsing([summary(1)]);
    const model = msgs.reduce((current, msg) => update(current, msg)[0], start);
    expect(model.focus.mode).not.toBe("browsing");
    expect(update(model, toggle())).toEqual([model, []]);
  });
});
