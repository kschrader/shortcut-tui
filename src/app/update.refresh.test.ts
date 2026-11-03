import { describe, expect, test } from "bun:test";
import { detail, doing, storyId, summary } from "./fixtures.ts";
import type { Effect, Model, Msg, RequestId } from "./model.ts";
import { awaited, reloadFailure } from "./remote.ts";
import { answer, browsing, first, loggedIn, only, submitQuery } from "./steps.ts";
import { update } from "./update.ts";

const shownStories = (model: Model) =>
  model.results.status === "loaded" ? model.results.value.stories : null;

const refresh = (model: Model) => update(model, { type: "refreshRequested" });

const withDetail = (): [Model, RequestId] => {
  const [model, effects] = browsing([summary(1), summary(2)]);
  const fetch = only(effects, "getStory");
  const [shown] = update(model, {
    type: "detailSucceeded",
    requestId: fetch.requestId,
    story: detail(1),
  });
  return [shown, fetch.requestId];
};

const body = (model: Model) => {
  const entry = model.details.get(storyId(1));
  return entry?.status === "loaded" ? entry.value : null;
};

const pickDoing = (model: Model): [Model, Effect[]] => {
  const msgs: Msg[] = [
    { type: "movePickerOpened" },
    { type: "movePickerMoved", delta: 1 },
    { type: "movePickerConfirmed" },
  ];
  return msgs.reduce<[Model, Effect[]]>(([current], msg) => update(current, msg), [model, []]);
};

describe("refreshing the same query", () => {
  test("keeps the shown stories and waits on the new search; a newer refresh supersedes it", () => {
    const [model] = browsing([summary(1), summary(2)]);
    const [refreshing, effects] = refresh(model);
    expect(shownStories(refreshing)).toEqual([summary(1), summary(2)]);
    expect(awaited(refreshing.results)).toBe(first(effects, "searchStories").requestId);
    const [again, againEffects] = refresh(refreshing);
    expect(awaited(again.results)).toBe(first(againEffects, "searchStories").requestId);
    expect(answer(again, first(effects, "searchStories"), [summary(3)])).toEqual([again, []]);
    const [fresh] = answer(again, first(againEffects, "searchStories"), [summary(3)]);
    expect(shownStories(fresh)).toEqual([summary(3)]);
    expect(awaited(fresh.results)).toBeNull();
  });

  test("a failed refresh keeps the stories and records why; a failed first load has nothing to keep", () => {
    const [model] = browsing([summary(1)]);
    const [refreshing, effects] = refresh(model);
    const failure: Msg = {
      type: "searchFailed",
      requestId: first(effects, "searchStories").requestId,
      message: "HTTP 503",
    };
    const [failed] = update(refreshing, failure);
    expect(shownStories(failed)).toEqual([summary(1)]);
    expect(reloadFailure(failed.results)).toBe("HTTP 503");
    const [retrying, retryEffects] = refresh(failed);
    expect(reloadFailure(retrying.results)).toBeNull();
    expect(awaited(retrying.results)).toBe(first(retryEffects, "searchStories").requestId);

    const [initial, search] = loggedIn();
    const [firstLoadFailed] = update(initial, {
      type: "searchFailed",
      requestId: search.requestId,
      message: "HTTP 503",
    });
    expect(firstLoadFailed.results).toEqual({ status: "failed", message: "HTTP 503" });
  });

  test("submitting a different query starts over, submitting the same query keeps the list", () => {
    const [model] = browsing([summary(1)]);
    const [different] = submitQuery(model, "label:other");
    expect(different.results.status).toBe("firstLoad");
    const [same] = submitQuery(model, model.query);
    expect(shownStories(same)).toEqual([summary(1)]);
    expect(awaited(same.results)).not.toBeNull();
  });

  test("auto-refresh waits while the refresh is out, then runs once it has answered", () => {
    const due: Msg = { type: "autoRefreshDue" };
    const [model] = browsing([summary(1)]);
    const [refreshing, effects] = refresh(model);
    expect(update(refreshing, due)).toEqual([refreshing, []]);
    const [answered] = answer(refreshing, first(effects, "searchStories"), [summary(1)]);
    const [, dueEffects] = update(answered, due);
    expect(first(dueEffects, "searchStories").query).toBe(model.query);
  });
});

describe("refreshing the selected detail", () => {
  test("keeps the body while the fetch is out and after it fails", () => {
    const [shown] = withDetail();
    const [refreshing, effects] = refresh(shown);
    const fetch = first(effects, "getStory");
    expect(body(refreshing)).toEqual(detail(1));
    expect(awaited(refreshing.details.get(storyId(1)))).toBe(fetch.requestId);
    const [failed] = update(refreshing, {
      type: "detailFailed",
      requestId: fetch.requestId,
      storyId: storyId(1),
      message: "timeout",
    });
    expect(body(failed)).toEqual(detail(1));
    expect(reloadFailure(failed.details.get(storyId(1)))).toBe("timeout");
    const [away] = update(failed, { type: "selectionMoved", delta: 1 });
    const [, retry] = update(away, { type: "selectionMoved", delta: -1 });
    expect(only(retry, "getStory").storyId).toBe(storyId(1));
  });

  test("a stale detail answer is ignored", () => {
    const [shown, originalFetch] = withDetail();
    const [refreshing] = refresh(shown);
    const stale: Msg = {
      type: "detailSucceeded",
      requestId: originalFetch,
      story: { ...detail(1), description: "older" },
    };
    expect(update(refreshing, stale)).toEqual([refreshing, []]);
  });
});

describe("moving a story while a refresh is out", () => {
  test("the pick shows at once, and the refresh answer keeps it before and after the move settles", () => {
    const [model] = browsing([summary(1)]);
    const [refreshing, refreshEffects] = refresh(model);
    const search = first(refreshEffects, "searchStories");
    const [picked, moveEffects] = pickDoing(refreshing);
    expect(shownStories(picked)?.[0]?.state).toEqual(doing);
    const [answeredWhileSaving] = answer(picked, search, [summary(1)]);
    expect(shownStories(answeredWhileSaving)?.[0]?.state).toEqual(doing);

    const [settled] = update(picked, {
      type: "moveSucceeded",
      requestId: first(moveEffects, "moveStory").requestId,
      storyId: storyId(1),
      story: { ...summary(1), state: doing },
    });
    const [answeredAfterSettling] = answer(settled, search, [summary(1)]);
    expect(shownStories(answeredAfterSettling)?.[0]?.state).toEqual(doing);
  });
});
