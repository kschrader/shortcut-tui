import { describe, expect, test } from "bun:test";
import { detail, storyId, summary, workspaceFor } from "./fixtures.ts";
import type { Model, Msg } from "./model.ts";
import { awaited, loaded } from "./remote.ts";
import { answer, browsing, first, loggedIn, myStartedQuery, only, submitQuery } from "./steps.ts";
import { init, update } from "./update.ts";

const due: Msg = { type: "autoRefreshDue" };

const idle = (): Model => {
  const [model] = browsing([summary(1), summary(2), summary(3)]);
  const [selected, effects] = update(model, { type: "selectionMoved", delta: 1 });
  const [shown] = update(selected, {
    type: "detailSucceeded",
    requestId: first(effects, "getStory").requestId,
    story: detail(2),
  });
  return shown;
};

describe("auto-refresh", () => {
  test("while browsing with nothing loading it refreshes exactly like r", () => {
    const model = idle();
    expect(update(model, due)).toEqual(update(model, { type: "refreshRequested" }));
    const [, effects] = update(model, due);
    expect(first(effects, "searchStories").query).toBe(myStartedQuery);
    expect(first(effects, "getStory").storyId).toBe(storyId(2));
  });

  test("keeps the selected story and its detail pane when the results come back", () => {
    const [refreshing, effects] = update(idle(), due);
    const [refreshed, refreshedEffects] = answer(
      refreshing,
      first(effects, "searchStories"),
      [summary(3), summary(2), summary(1)],
      new Date("2026-11-02T09:05:00Z"),
    );
    expect(refreshed.selectedStoryId).toBe(storyId(2));
    const kept = refreshed.details.get(storyId(2));
    expect(kept?.status === "loaded" ? kept.value : null).toEqual(detail(2));
    expect(awaited(kept)).toBe(first(effects, "getStory").requestId);
    expect(refreshedEffects.filter((effect) => effect.type === "getStory")).toEqual([]);
    expect(refreshed.loadedAt).toEqual(new Date("2026-11-02T09:05:00Z"));
  });

  test.each<[string, Msg[]]>([
    ["editing the query", [{ type: "queryEditStarted" }]],
    ["reading help", [{ type: "helpOpened" }]],
    ["picking a state", [{ type: "movePickerOpened" }]],
  ])("does nothing while the user is %s", (_, msgs) => {
    const model = msgs.reduce((current, msg) => update(current, msg)[0], idle());
    expect(model.focus.mode).not.toBe("browsing");
    expect(update(model, due)).toEqual([model, []]);
  });

  test("does nothing while the read-only notice is open", () => {
    const [initial, search] = loggedIn();
    const readOnly: Model = {
      ...initial,
      workspace: loaded(workspaceFor("kurt", false)),
    };
    const [model] = answer(readOnly, search, [summary(1)]);
    const [notice] = update(model, { type: "movePickerOpened" });
    expect(notice.focus.mode).toBe("readOnly");
    expect(update(notice, due)).toEqual([notice, []]);
  });

  test("does nothing while a search is in flight, so it cannot supersede the user's query", () => {
    const [searching, effects] = submitQuery(idle(), "label:urgent");
    only(effects, "searchStories");
    expect(update(searching, due)).toEqual([searching, []]);
  });

  test("does nothing while pull request status is loading", () => {
    const [model] = browsing([{ ...summary(1), pullRequestCount: 1 }]);
    expect(model.pullRequests.reload.status).toBe("inFlight");
    expect(update(model, due)).toEqual([model, []]);
  });

  test("retries a failed search, like r", () => {
    const [model, search] = loggedIn();
    const [failed] = update(model, {
      type: "searchFailed",
      requestId: search.requestId,
      message: "HTTP 503",
    });
    const [, effects] = update(failed, due);
    expect(only(effects, "searchStories").query).toBe(myStartedQuery);
  });
});

describe("terminal focus", () => {
  const loadedAt = new Date("2026-11-02T09:00:00Z");
  const focusedAfter = (ms: number): Msg => ({
    type: "terminalFocused",
    at: new Date(loadedAt.getTime() + ms),
  });

  test("refreshes exactly like auto-refresh once the shown results are 30 seconds old", () => {
    const model = idle();
    expect(model.loadedAt).toEqual(loadedAt);
    expect(update(model, focusedAfter(30_000))).toEqual(update(model, due));
    const [, effects] = update(model, focusedAfter(30_000));
    expect(first(effects, "searchStories").query).toBe(myStartedQuery);
  });

  test("does nothing while the shown results are fresher than 30 seconds", () => {
    const model = idle();
    expect(update(model, focusedAfter(29_999))).toEqual([model, []]);
  });

  test("does nothing while the user is reading help, however old the results", () => {
    const [help] = update(idle(), { type: "helpOpened" });
    expect(update(help, focusedAfter(600_000))).toEqual([help, []]);
  });

  test("retries a workspace that failed to load", () => {
    const [initial, initEffects] = init();
    const [failed] = update(initial, {
      type: "workspaceFailed",
      requestId: only(initEffects, "loadWorkspace").requestId,
      message: "HTTP 503",
    });
    expect(failed.loadedAt).toBeNull();
    const [, effects] = update(failed, { type: "terminalFocused", at: loadedAt });
    only(effects, "loadWorkspace");
  });
});
