import { describe, expect, test } from "bun:test";
import type { StorySummary } from "../shortcut/types.ts";
import { detail, inState, storyId, summary, workspaceFor } from "./fixtures.ts";
import type { Effect, Model, Msg } from "./model.ts";
import { init, update } from "./update.ts";

type EffectOf<K extends Effect["type"]> = Extract<Effect, { type: K }>;

const ofType = <K extends Effect["type"]>(effects: Effect[], type: K): EffectOf<K>[] =>
  effects.filter((effect): effect is EffectOf<K> => effect.type === type);

const first = <K extends Effect["type"]>(effects: Effect[], type: K): EffectOf<K> => {
  const [effect] = ofType(effects, type);
  if (effect === undefined) throw new Error(`expected a ${type} effect`);
  return effect;
};

const only = <K extends Effect["type"]>(effects: Effect[], type: K): EffectOf<K> => {
  expect(effects.map((effect) => effect.type)).toEqual([type]);
  return first(effects, type);
};

const loggedIn = (): [Model, EffectOf<"searchStories">] => {
  const [initial, initEffects] = init();
  const load = only(initEffects, "loadWorkspace");
  const [model, effects] = update(initial, {
    type: "workspaceLoaded",
    requestId: load.requestId,
    workspace: workspaceFor("kurt"),
  });
  return [model, only(effects, "searchStories")];
};

const answer = (
  model: Model,
  search: EffectOf<"searchStories">,
  stories: readonly StorySummary[],
): [Model, Effect[]] =>
  update(model, { type: "searchSucceeded", requestId: search.requestId, stories });

const browsing = (stories: readonly StorySummary[]): [Model, Effect[]] => {
  const [model, search] = loggedIn();
  return answer(model, search, stories);
};

const submitQuery = (model: Model, draft: string): [Model, Effect[]] => {
  const msgs: Msg[] = [
    { type: "queryEditStarted" },
    { type: "queryDraftChanged", draft },
    { type: "querySubmitted" },
  ];
  let current = model;
  const effects: Effect[] = [];
  for (const msg of msgs) {
    const [next, emitted] = update(current, msg);
    current = next;
    effects.push(...emitted);
  }
  return [current, effects];
};

describe("startup", () => {
  test("init loads the workspace before anything else", () => {
    const [model, effects] = init();
    only(effects, "loadWorkspace");
    expect(model.workspace.status).toBe("loading");
    expect(model.selectedStoryId).toBeNull();
  });

  test("a loaded workspace searches for my open stories", () => {
    const [model, search] = loggedIn();
    expect(search.query).toBe("owner:kurt !is:done !is:archived");
    expect(model.query).toBe("owner:kurt !is:done !is:archived");
    expect(model.results.status).toBe("loading");
  });

  test("a failed workspace is retried by refresh", () => {
    const [initial, effects] = init();
    const load = only(effects, "loadWorkspace");
    const [failed] = update(initial, {
      type: "workspaceFailed",
      requestId: load.requestId,
      message: "401",
    });
    expect(failed.workspace).toEqual({ status: "failed", message: "401" });
    const [, retry] = update(failed, { type: "refreshRequested" });
    expect(only(retry, "loadWorkspace").requestId).not.toBe(load.requestId);
  });

  test("query editing waits for the workspace so its default query cannot clobber mine", () => {
    const [initial] = init();
    const [model, effects] = update(initial, { type: "queryEditStarted" });
    expect(model.focus).toEqual({ mode: "browsing" });
    expect(effects).toEqual([]);
  });
});

describe("search results", () => {
  test("loading results selects the first story and fetches its detail", () => {
    const [model, effects] = browsing([summary(1), summary(2)]);
    expect(model.selectedStoryId).toBe(storyId(1));
    expect(only(effects, "getStory").storyId).toBe(storyId(1));
  });

  test("empty results select nothing and fetch nothing", () => {
    const [model, effects] = browsing([]);
    expect(model.selectedStoryId).toBeNull();
    expect(effects).toEqual([]);
  });

  test("a response to a superseded search is dropped", () => {
    const [model, superseded] = loggedIn();
    const [submitted, effects] = submitQuery(model, "label:urgent");
    const second = only(effects, "searchStories");
    expect(second.query).toBe("label:urgent");

    const [afterStale, staleEffects] = answer(submitted, superseded, [summary(1)]);
    expect(afterStale).toBe(submitted);
    expect(staleEffects).toEqual([]);

    const [afterFresh] = answer(afterStale, second, [summary(7)]);
    expect(afterFresh.results).toEqual({
      status: "loaded",
      value: { query: "label:urgent", stories: [summary(7)] },
    });
  });

  test("a duplicated search response is applied once", () => {
    const [model, search] = loggedIn();
    const [once] = answer(model, search, [summary(1)]);
    const [twice, effects] = answer(once, search, [summary(2)]);
    expect(twice).toBe(once);
    expect(effects).toEqual([]);
  });

  test("a failed search is reported", () => {
    const [model, search] = loggedIn();
    const [failed] = update(model, {
      type: "searchFailed",
      requestId: search.requestId,
      message: "boom",
    });
    expect(failed.results).toEqual({ status: "failed", message: "boom" });
  });

  test("refreshed results keep the selected story when it is still present", () => {
    const [model] = browsing([summary(1), summary(2)]);
    const [moved] = update(model, { type: "selectionMoved", delta: 1 });
    const [refreshing, effects] = update(moved, { type: "refreshRequested" });
    const [refreshed] = answer(refreshing, first(effects, "searchStories"), [
      summary(3),
      summary(2),
    ]);
    expect(refreshed.selectedStoryId).toBe(storyId(2));
  });

  test("refreshed results select the first story when the selected one is gone", () => {
    const [model] = browsing([summary(1), summary(2)]);
    const [refreshing, effects] = update(model, { type: "refreshRequested" });
    const [refreshed, refreshedEffects] = answer(refreshing, first(effects, "searchStories"), [
      summary(5),
      summary(6),
    ]);
    expect(refreshed.selectedStoryId).toBe(storyId(5));
    expect(only(refreshedEffects, "getStory").storyId).toBe(storyId(5));
  });
});

describe("selection and detail", () => {
  test("moving the selection clamps at both ends", () => {
    const [model] = browsing([summary(1), summary(2), summary(3)]);
    const [up] = update(model, { type: "selectionMoved", delta: -1 });
    expect(up.selectedStoryId).toBe(storyId(1));
    const [down] = update(model, { type: "selectionMoved", delta: 10 });
    expect(down.selectedStoryId).toBe(storyId(3));
  });

  test("moving onto a story without a detail fetches it, once", () => {
    const [model] = browsing([summary(1), summary(2)]);
    const [moved, effects] = update(model, { type: "selectionMoved", delta: 1 });
    expect(only(effects, "getStory").storyId).toBe(storyId(2));
    const [back] = update(moved, { type: "selectionMoved", delta: -1 });
    const [, again] = update(back, { type: "selectionMoved", delta: 1 });
    expect(again).toEqual([]);
  });

  test("a loaded detail is stored under its story", () => {
    const [model, effects] = browsing([summary(1)]);
    const fetch = only(effects, "getStory");
    const [loaded] = update(model, {
      type: "detailSucceeded",
      requestId: fetch.requestId,
      story: detail(1),
    });
    expect(loaded.details.get(storyId(1))).toEqual({ status: "loaded", value: detail(1) });
  });

  test("selecting a story whose detail failed fetches it again", () => {
    const [model, effects] = browsing([summary(1), summary(2)]);
    const fetch = only(effects, "getStory");
    const [failed] = update(model, {
      type: "detailFailed",
      requestId: fetch.requestId,
      storyId: storyId(1),
      message: "timeout",
    });
    const [away] = update(failed, { type: "selectionMoved", delta: 1 });
    const [, retry] = update(away, { type: "selectionMoved", delta: -1 });
    expect(only(retry, "getStory").storyId).toBe(storyId(1));
  });

  test("refresh refetches the selected detail and drops the older response", () => {
    const [model, effects] = browsing([summary(1)]);
    const original = only(effects, "getStory");
    const [refreshing, refreshEffects] = update(model, { type: "refreshRequested" });
    expect(first(refreshEffects, "getStory").storyId).toBe(storyId(1));
    expect(ofType(refreshEffects, "searchStories").map((effect) => effect.query)).toEqual([
      "owner:kurt !is:done !is:archived",
    ]);

    const [afterStale] = update(refreshing, {
      type: "detailSucceeded",
      requestId: original.requestId,
      story: detail(1),
    });
    expect(afterStale.details.get(storyId(1))?.status).toBe("loading");
  });
});

describe("default order", () => {
  const backlog = { name: "Backlog", progress: "unstarted", position: 0 } as const;
  const ready = { name: "Ready for Development", progress: "unstarted", position: 4 } as const;
  const inDevelopment = { name: "In Development", progress: "started", position: 5 } as const;
  const inReview = { name: "Waiting for Review", progress: "started", position: 6 } as const;

  test("stories further right in the workflow come first", () => {
    const [model] = browsing([
      inState(summary(1), backlog),
      inState(summary(2), inReview),
      inState(summary(3), ready),
      inState(summary(4), inDevelopment),
    ]);
    if (model.results.status !== "loaded") throw new Error("results not loaded");
    expect(model.results.value.stories.map((story) => story.state.name)).toEqual([
      "Waiting for Review",
      "In Development",
      "Ready for Development",
      "Backlog",
    ]);
    expect(model.selectedStoryId).toBe(storyId(2));
  });

  test("a started state outranks an unstarted one from another workflow at a higher position", () => {
    const [model] = browsing([
      inState(summary(1), { name: "Ideas", progress: "unstarted", position: 9 }),
      inState(summary(2), { name: "In Progress", progress: "started", position: 1 }),
    ]);
    if (model.results.status !== "loaded") throw new Error("results not loaded");
    expect(model.results.value.stories.map((story) => story.id)).toEqual([storyId(2), storyId(1)]);
  });

  test("stories in the same state put the most recently updated first", () => {
    const [model] = browsing([
      inState(summary(1), ready, new Date("2026-10-01T00:00:00Z")),
      inState(summary(2), ready, new Date("2026-10-20T00:00:00Z")),
    ]);
    if (model.results.status !== "loaded") throw new Error("results not loaded");
    expect(model.results.value.stories.map((story) => story.id)).toEqual([storyId(2), storyId(1)]);
  });
});

describe("query editing", () => {
  test("editing starts from the current query and submitting searches the draft", () => {
    const [model] = browsing([]);
    const [editing] = update(model, { type: "queryEditStarted" });
    expect(editing.focus).toMatchObject({ mode: "editingQuery" });
    const [submitted, effects] = submitQuery(model, "is:started");
    expect(submitted.focus).toEqual({ mode: "browsing" });
    expect(submitted.query).toBe("is:started");
    expect(only(effects, "searchStories").query).toBe("is:started");
  });

  test("text typed after the current query becomes a separate search term", () => {
    const [model] = browsing([]);
    const [editing] = update(model, { type: "queryEditStarted" });
    const draft = editing.focus.mode === "editingQuery" ? editing.focus.draft : "";
    const [submitted, effects] = submitQuery(model, `${draft}webhook`);
    expect(submitted.query).toBe(`${model.query} webhook`);
    expect(only(effects, "searchStories").query).toBe(`${model.query} webhook`);
  });

  test("surrounding whitespace in a submitted query is dropped", () => {
    const [model] = browsing([]);
    const [submitted] = submitQuery(model, "  is:started  ");
    expect(submitted.query).toBe("is:started");
  });

  test("cancelling keeps the old query and searches nothing", () => {
    const [model] = browsing([]);
    const [editing] = update(model, { type: "queryEditStarted" });
    const [typed] = update(editing, { type: "queryDraftChanged", draft: "abc" });
    const [cancelled, effects] = update(typed, { type: "queryEditCancelled" });
    expect(cancelled.focus).toEqual({ mode: "browsing" });
    expect(cancelled.query).toBe(model.query);
    expect(effects).toEqual([]);
  });

  test("submitting while browsing does nothing", () => {
    const [model] = browsing([]);
    const [after, effects] = update(model, { type: "querySubmitted" });
    expect(after).toBe(model);
    expect(effects).toEqual([]);
  });
});
