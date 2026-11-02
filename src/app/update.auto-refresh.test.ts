import { describe, expect, test } from "bun:test";
import { storyId, summary, workspaceFor } from "./fixtures.ts";
import type { Model, Msg } from "./model.ts";
import { answer, browsing, first, loggedIn, only, submitQuery } from "./steps.ts";
import { update } from "./update.ts";

const due: Msg = { type: "autoRefreshDue" };

const idle = (): Model => {
  const [model] = browsing([summary(1), summary(2), summary(3)]);
  const [selected] = update(model, { type: "selectionMoved", delta: 1 });
  return selected;
};

describe("auto-refresh", () => {
  test("while browsing with nothing loading it refreshes exactly like r", () => {
    const model = idle();
    expect(update(model, due)).toEqual(update(model, { type: "refreshRequested" }));
    const [, effects] = update(model, due);
    expect(first(effects, "searchStories").query).toBe(model.query);
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
    expect(refreshed.details.get(storyId(2))?.status).toBe("loading");
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
      workspace: { status: "loaded", value: workspaceFor("kurt", false) },
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
    expect(model.pullRequests.status).toBe("loading");
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
    expect(only(effects, "searchStories").query).toBe(model.query);
  });
});
