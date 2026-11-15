import { describe, expect, test } from "bun:test";
import { doing, finished, inState, storyId, summary, workspaceFor } from "./fixtures.ts";
import { changesOf, unseenChanges } from "./glance.ts";
import type { Model, StartupList } from "./model.ts";
import { requestsIn } from "./remote.ts";
import { answer, first, myStartedQuery, ofType, only, submitQuery } from "./steps.ts";
import { init, update } from "./update.ts";

const savedAt = new Date("2026-11-02T06:00:00Z");
const answeredAt = new Date("2026-11-02T09:00:00Z");
const cachedStories = [inState(summary(1), doing), summary(2), summary(3)];
const saved: StartupList = { mentionName: "kurt", savedAt, stories: cachedStories };

const shownIds = (model: Model) =>
  model.results.status === "loaded" ? model.results.value.stories.map((story) => story.id) : null;

const cachedAtOf = (model: Model) =>
  model.results.status === "loaded" ? model.results.value.cachedAt : "not loaded";

const started = () => {
  const [model, effects] = init(saved);
  return { model, load: only(effects, "loadWorkspace") };
};

const loggedIn = (mentionName = "kurt") => {
  const { model, load } = started();
  const [loaded, effects] = update(model, {
    type: "workspaceLoaded",
    requestId: load.requestId,
    workspace: workspaceFor(mentionName),
  });
  return { model: loaded, effects };
};

const answered = (stories = [summary(2), summary(4)]) => {
  const { model, effects } = loggedIn();
  return answer(model, only(effects, "searchStories"), stories, answeredAt);
};

describe("a saved startup list", () => {
  test("shows at once, marked cached with when it was saved", () => {
    const { model } = started();
    expect(shownIds(model)).toEqual([storyId(1), storyId(2), storyId(3)]);
    expect(cachedAtOf(model)).toEqual(savedAt);
    expect(model.question.view).toEqual({ kind: "query", text: myStartedQuery });
    expect(model.workspace.status).toBe("firstLoad");
  });

  test("selects its first row, fetches no details, and marks nothing as changed", () => {
    const [model, effects] = init(saved);
    expect(model.selectedStoryId).toBe(storyId(1));
    expect(requestsIn(effects).map((effect) => effect.type)).toEqual(["loadWorkspace"]);
    expect(unseenChanges(model).size).toBe(0);
    expect(changesOf(model, storyId(1))).toEqual([]);
  });

  test("moving the selection over cached rows fetches no details", () => {
    const { model } = started();
    const [moved, effects] = update(model, { type: "selectionMoved", delta: 1 });
    expect(moved.selectedStoryId).toBe(storyId(2));
    expect(effects).toEqual([]);
    const [clicked, clickEffects] = update(moved, { type: "storyClicked", storyId: storyId(3) });
    expect(clicked.selectedStoryId).toBe(storyId(3));
    expect(clickEffects).toEqual([]);
  });

  test("m opens no picker before the workspace loads", () => {
    const { model } = started();
    const [after, effects] = update(model, { type: "movePickerOpened" });
    expect(after.focus).toEqual({ mode: "browsing" });
    expect(effects).toEqual([]);
  });

  test("m opens no picker after the workspace loads while the cached list still shows", () => {
    const { model } = loggedIn();
    expect(model.workspace.status).toBe("loaded");
    const [after, effects] = update(model, { type: "movePickerOpened" });
    expect(after.focus).toEqual({ mode: "browsing" });
    expect(effects).toEqual([]);
  });

  test("stays on screen, still cached, while the first search is out", () => {
    const { model, effects } = loggedIn();
    expect(only(effects, "searchStories").queries).toEqual([myStartedQuery]);
    expect(model.results.status).toBe("loaded");
    expect(shownIds(model)).toEqual([storyId(1), storyId(2), storyId(3)]);
    expect(cachedAtOf(model)).toEqual(savedAt);
  });

  test("refresh while it shows searches again without fetching cached details", () => {
    const { model } = loggedIn();
    const [, effects] = update(model, { type: "refreshRequested" });
    expect(requestsIn(effects).map((effect) => effect.type)).toEqual(["searchStories"]);
  });

  test("a failed first search keeps it, still cached", () => {
    const { model, effects } = loggedIn();
    const [failed] = update(model, {
      type: "searchFailed",
      requestId: only(effects, "searchStories").requestId,
      message: "HTTP 503",
    });
    expect(shownIds(failed)).toEqual([storyId(1), storyId(2), storyId(3)]);
    expect(cachedAtOf(failed)).toEqual(savedAt);
  });

  test("a failed workspace keeps it, still cached", () => {
    const { model, load } = started();
    const [failed] = update(model, {
      type: "workspaceFailed",
      requestId: load.requestId,
      message: "offline",
    });
    expect(shownIds(failed)).toEqual([storyId(1), storyId(2), storyId(3)]);
    expect(cachedAtOf(failed)).toEqual(savedAt);
  });

  test("the first search answer replaces it as a refresh would, and it is no longer cached", () => {
    const [model, effects] = answered();
    expect(shownIds(model)).toEqual([storyId(2), storyId(4)]);
    expect(cachedAtOf(model)).toBeNull();
    expect(model.loadedAt).toEqual(answeredAt);
    expect(model.selectedStoryId).toBe(storyId(2));
    expect(first(effects, "getStory").storyId).toBe(storyId(2));
  });

  test("the answer keeps a selection that is still listed", () => {
    const { model, effects } = loggedIn();
    const [moved] = update(model, { type: "selectionMoved", delta: 1 });
    const [replaced] = answer(moved, only(effects, "searchStories"), [summary(4), summary(2)]);
    expect(replaced.selectedStoryId).toBe(storyId(2));
  });

  test("the answer marks nothing as changed, as each start began before", () => {
    const [model] = answered([inState(summary(1), finished), summary(2), summary(4)]);
    expect(unseenChanges(model).size).toBe(0);
  });

  test("after the answer, m opens the picker", () => {
    const [model] = answered();
    const [after] = update(model, { type: "movePickerOpened" });
    expect(after.focus.mode).toBe("picking");
  });

  test("a different member's workspace drops it, and its selection, for a first load", () => {
    const { model } = loggedIn("grace");
    expect(model.results.status).toBe("firstLoad");
    expect(model.selectedStoryId).toBeNull();
  });

  test("a new query drops it and its selection, so no cached row waits on a detail", () => {
    const { model } = loggedIn();
    const [moved] = update(model, { type: "selectionMoved", delta: 1 });
    const [searching, effects] = submitQuery(moved, "label:urgent");
    expect(searching.results.status).toBe("firstLoad");
    expect(searching.selectedStoryId).toBeNull();
    const [shown, answerEffects] = answer(searching, first(effects, "searchStories"), [
      summary(2),
      summary(6),
    ]);
    expect(shown.selectedStoryId).toBe(storyId(2));
    expect(first(answerEffects, "getStory").storyId).toBe(storyId(2));
  });
});

describe("saving the startup list", () => {
  test("the answer to the startup search saves what it shows", () => {
    const [, effects] = answered();
    expect(ofType(effects, "saveStartupList")).toEqual([
      {
        type: "saveStartupList",
        list: { mentionName: "kurt", savedAt: answeredAt, stories: [summary(2), summary(4)] },
      },
    ]);
  });

  test("a startup search with no saved list saves too", () => {
    const [initial, initEffects] = init();
    const [model, effects] = update(initial, {
      type: "workspaceLoaded",
      requestId: only(initEffects, "loadWorkspace").requestId,
      workspace: workspaceFor("kurt"),
    });
    const [, answerEffects] = answer(model, only(effects, "searchStories"), [summary(5)]);
    expect(ofType(answerEffects, "saveStartupList").map((effect) => effect.list.stories)).toEqual([
      [summary(5)],
    ]);
  });

  test("a typed query, a filter, or the age floor saves nothing", () => {
    const [shown] = answered();
    const [typed, typedEffects] = submitQuery(shown, "label:urgent");
    const [, typedAnswer] = answer(typed, first(typedEffects, "searchStories"), [summary(6)]);
    const [filtered, filterEffects] = update(shown, { type: "filterCycled" });
    const [, filterAnswer] = answer(filtered, first(filterEffects, "searchStories"), [summary(7)]);
    const [floored, floorEffects] = update(shown, { type: "ageFloorToggled", at: answeredAt });
    const [, floorAnswer] = answer(floored, first(floorEffects, "searchStories"), [summary(8)]);
    for (const effects of [typedAnswer, filterAnswer, floorAnswer]) {
      expect(ofType(effects, "saveStartupList")).toEqual([]);
    }
  });

  test("a failed search saves nothing", () => {
    const { model, effects } = loggedIn();
    const [, failEffects] = update(model, {
      type: "searchFailed",
      requestId: only(effects, "searchStories").requestId,
      message: "HTTP 503",
    });
    expect(failEffects).toEqual([]);
  });
});
