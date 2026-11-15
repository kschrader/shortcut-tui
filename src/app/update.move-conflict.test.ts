import { expect, test } from "bun:test";
import type { StoryDetail, StorySummary } from "../shortcut/types.ts";
import { detail, doing, finished, inState, storyId, summary, toDo } from "./fixtures.ts";
import { unseenChanges } from "./glance.ts";
import type { Effect, Model } from "./model.ts";
import { answer, browsing, first, only, pick, shown, stateOf, type EffectOf } from "./steps.ts";
import { update } from "./update.ts";

const movedElsewhere = (id: number): StorySummary => ({
  ...summary(id, `Story ${String(id)} (renamed)`),
  state: doing,
  updatedAt: new Date(60_000),
  movedAt: new Date(60_000),
});

const conflict = (
  model: Model,
  move: EffectOf<"moveStory">,
  story: StorySummary = movedElsewhere(move.storyId),
): [Model, Effect[]] =>
  update(model, {
    type: "moveConflicted",
    requestId: move.requestId,
    storyId: move.storyId,
    story,
  });

const confirm = (model: Model, move: EffectOf<"moveStory">): [Model, Effect[]] =>
  update(model, {
    type: "moveSucceeded",
    requestId: move.requestId,
    storyId: move.storyId,
    story: { ...summary(move.storyId), state: finished },
  });

test("a move names the state the app believes Shortcut holds, also for a queued pick sent after a confirmed move", () => {
  const [model] = browsing([summary(1)]);
  const [picked, effects] = pick(model, "Finished");
  const sent = only(effects, "moveStory");
  expect(sent).toMatchObject({ stateId: finished.id, knownStateId: toDo.id });
  const [queued] = pick(picked, "Doing");
  const [, confirmedEffects] = confirm(queued, sent);
  expect(only(confirmedEffects, "moveStory")).toMatchObject({
    stateId: doing.id,
    knownStateId: finished.id,
  });
});

test("a conflict shows the story as Shortcut holds it, fails the move, and sends nothing", () => {
  const [model] = browsing([summary(1), inState(summary(2), doing)]);
  const [onFirst] = update(model, { type: "selectionMoved", delta: 1 });
  const [picked, effects] = pick(onFirst, "Finished");
  expect(stateOf(picked, 1)).toBe("Finished");
  const [conflicted, conflictEffects] = conflict(picked, only(effects, "moveStory"));
  expect(conflictEffects).toEqual([]);
  expect(shown(conflicted).find((story) => story.id === storyId(1))).toEqual(movedElsewhere(1));
  expect(conflicted.selectedStoryId).toBe(storyId(1));
  expect(conflicted.moves.get(storyId(1))?.status).toBe("failed");
});

test("a conflict drops the queued pick, because you picked it before the story moved", () => {
  const [model] = browsing([summary(1)]);
  const [picked, effects] = pick(model, "Finished");
  const [queued, queuedEffects] = pick(picked, "To Do");
  expect(queuedEffects).toEqual([]);
  expect(stateOf(queued, 1)).toBe("To Do");
  const [conflicted, conflictEffects] = conflict(queued, only(effects, "moveStory"));
  expect(conflictEffects).toEqual([]);
  expect(stateOf(conflicted, 1)).toBe("Doing");
  expect(conflicted.moves.get(storyId(1))?.status).toBe("failed");
});

test("a retry after a conflict is sent against the state the conflict read", () => {
  const [model] = browsing([summary(1)]);
  const [picked, effects] = pick(model, "Finished");
  const [conflicted] = conflict(picked, only(effects, "moveStory"));
  const [retried, retryEffects] = pick(conflicted, "Finished");
  expect(only(retryEffects, "moveStory")).toMatchObject({
    stateId: finished.id,
    knownStateId: doing.id,
  });
  expect(retried.moves.get(storyId(1))?.status).toBe("saving");
});

test("a refresh sent before the conflict cannot bring back the old state, and one sent after is believed", () => {
  const [model] = browsing([summary(1)]);
  const [picked, effects] = pick(model, "Finished");
  const [refreshing, refreshEffects] = update(picked, { type: "refreshRequested" });
  const stale = first(refreshEffects, "searchStories");
  const [conflicted] = conflict(refreshing, only(effects, "moveStory"));
  const [afterStale] = answer(conflicted, stale, [summary(1)]);
  expect(stateOf(afterStale, 1)).toBe("Doing");
  expect(afterStale.moves.get(storyId(1))?.status).toBe("failed");
  const [again, againEffects] = update(afterStale, { type: "refreshRequested" });
  const [fresh] = answer(again, first(againEffects, "searchStories"), [
    inState(summary(1), finished),
  ]);
  expect(stateOf(fresh, 1)).toBe("Finished");
  expect(fresh.moves.has(storyId(1))).toBe(false);
});

test("a conflict does not mark the story as changed, also after the next refresh agrees with it", () => {
  const [model] = browsing([summary(1), summary(2)]);
  const [picked, effects] = pick(model, "Finished");
  const [elsewhere] = update(picked, { type: "selectionMoved", delta: 1 });
  expect(elsewhere.selectedStoryId).toBe(storyId(2));
  const [conflicted] = conflict(elsewhere, only(effects, "moveStory"));
  expect(unseenChanges(conflicted).has(storyId(1))).toBe(false);
  const [refreshing, refreshEffects] = update(conflicted, { type: "refreshRequested" });
  const [refreshed] = answer(refreshing, first(refreshEffects, "searchStories"), [
    movedElsewhere(1),
    summary(2),
  ]);
  expect(refreshed.moves.has(storyId(1))).toBe(false);
  expect(unseenChanges(refreshed).has(storyId(1))).toBe(false);
});

test("a conflict for a request that is no longer in flight is dropped", () => {
  const [model] = browsing([summary(1)]);
  const [picked, effects] = pick(model, "Finished");
  const move = only(effects, "moveStory");
  const [confirmed] = confirm(picked, move);
  const [late, lateEffects] = conflict(confirmed, move);
  expect(late).toBe(confirmed);
  expect(lateEffects).toEqual([]);
  const [conflicted] = conflict(picked, move);
  const [again, againEffects] = conflict(conflicted, move);
  expect(again).toBe(conflicted);
  expect(againEffects).toEqual([]);
});

test("a sub-task's conflict shows the state Shortcut holds in its parent's sub-task section", () => {
  const parent: StoryDetail = { ...detail(1), subTasks: [summary(2), summary(3)] };
  const [model, effects] = browsing([summary(1), summary(2), summary(3)]);
  const [loaded] = update(model, {
    type: "detailSucceeded",
    requestId: only(effects, "getStory").requestId,
    story: parent,
  });
  const [onChild] = update(loaded, { type: "selectionMoved", delta: 1 });
  const [picked, pickEffects] = pick(onChild, "Finished");
  const [conflicted] = conflict(picked, first(pickEffects, "moveStory"));
  const shownParent = conflicted.details.get(storyId(1));
  if (shownParent?.status !== "loaded") throw new Error("the parent's detail is not loaded");
  expect(shownParent.value.subTasks.map((story) => [story.id, story.state.name])).toEqual([
    [storyId(2), "Doing"],
    [storyId(3), "To Do"],
  ]);
});
