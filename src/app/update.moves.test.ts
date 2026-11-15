import { describe, expect, test } from "bun:test";
import type { StorySummary, WorkflowState, WorkflowStateId } from "../shortcut/types.ts";
import {
  doing,
  finished,
  inState,
  storyId,
  summary,
  toDo,
  workflowState,
  workflowStates,
  workspaceFor,
} from "./fixtures.ts";
import type { Effect, Model } from "./model.ts";
import { answer, browsing, first, only, type EffectOf } from "./steps.ts";
import { pickerStates } from "./moves.ts";
import { init, update } from "./update.ts";

const shown = (model: Model): readonly StorySummary[] => {
  if (model.results.status !== "loaded") throw new Error("results not loaded");
  return model.results.value.stories;
};

const stateOf = (model: Model, id: number): string | undefined =>
  shown(model).find((story) => story.id === storyId(id))?.state.name;

const stateById = (id: WorkflowStateId): WorkflowState => {
  const state = workflowStates.find((candidate) => candidate.id === id);
  if (state === undefined) throw new Error(`no fixture state ${String(id)}`);
  return state;
};

const pick = (model: Model, stateName: string): [Model, Effect[]] => {
  const [open, openEffects] = update(model, { type: "movePickerOpened" });
  expect(openEffects).toEqual([]);
  const { focus } = open;
  if (focus.mode !== "picking" || open.workspace.status !== "loaded") {
    throw new Error(`picker did not open (focus ${focus.mode})`);
  }
  const story = shown(open).find((candidate) => candidate.id === focus.storyId);
  if (story === undefined) throw new Error("picker story is not shown");
  const index = pickerStates(open.workspace.value, story).findIndex(
    (state) => state.name === stateName,
  );
  const [moved] = update(open, { type: "movePickerMoved", delta: index - focus.cursor });
  return update(moved, { type: "movePickerConfirmed" });
};

const serverStory = (move: EffectOf<"moveStory">, name = `Story ${String(move.storyId)}`) => ({
  ...summary(move.storyId, name),
  state: stateById(move.stateId),
  updatedAt: new Date(1_000 * move.requestId),
});

const succeed = (
  model: Model,
  move: EffectOf<"moveStory">,
  story: StorySummary = serverStory(move),
): [Model, Effect[]] =>
  update(model, { type: "moveSucceeded", requestId: move.requestId, storyId: move.storyId, story });

const fail = (model: Model, move: EffectOf<"moveStory">, message = "boom"): [Model, Effect[]] =>
  update(model, { type: "moveFailed", requestId: move.requestId, storyId: move.storyId, message });

describe("the move picker", () => {
  test("m opens the picker on the selected story with the cursor on its current state", () => {
    const [model] = browsing([summary(1), inState(summary(2), doing)]);
    expect(model.selectedStoryId).toBe(storyId(2));
    const [open, effects] = update(model, { type: "movePickerOpened" });
    expect(open.focus).toEqual({ mode: "picking", storyId: storyId(2), cursor: 1 });
    expect(effects).toEqual([]);
  });

  test("a read-only token gets the read-only notice instead of the picker, and esc closes it", () => {
    const [initial, initEffects] = init();
    const [loggedIn, searchEffects] = update(initial, {
      type: "workspaceLoaded",
      requestId: only(initEffects, "loadWorkspace").requestId,
      workspace: workspaceFor("kurt", false),
    });
    const [model] = answer(loggedIn, only(searchEffects, "searchStories"), [summary(1)]);
    const [notice, effects] = update(model, { type: "movePickerOpened" });
    expect(notice.focus).toEqual({ mode: "readOnly" });
    expect(effects).toEqual([]);
    const [confirmed, confirmEffects] = update(notice, { type: "movePickerConfirmed" });
    expect(confirmed).toBe(notice);
    expect(confirmEffects).toEqual([]);
    const [closed] = update(notice, { type: "readOnlyNoticeClosed" });
    expect(closed.focus).toEqual({ mode: "browsing" });
  });

  test("the cursor walks the story's workflow states in order and clamps at both ends", () => {
    const [model] = browsing([summary(1)]);
    const [open] = update(model, { type: "movePickerOpened" });
    const cursorAfter = (delta: number) => {
      const [moved] = update(open, { type: "movePickerMoved", delta });
      return moved.focus.mode === "picking" ? moved.focus.cursor : null;
    };
    expect(cursorAfter(-1)).toBe(0);
    expect(cursorAfter(1)).toBe(1);
    expect(cursorAfter(2)).toBe(2);
    expect(cursorAfter(9)).toBe(2);
  });

  test("the picker lists only the story's own workflow, in position order", () => {
    const marketing = { id: 2, name: "Marketing" };
    const workspace = {
      ...workspaceFor("kurt"),
      workflowStates: [
        workflowState(21, "Live", "done", 2, marketing),
        finished,
        toDo,
        workflowState(20, "Draft", "unstarted", 0, marketing),
        doing,
      ],
    };
    expect(pickerStates(workspace, summary(1)).map((state) => state.name)).toEqual([
      "To Do",
      "Doing",
      "Finished",
    ]);
  });

  test("esc closes the picker without moving anything", () => {
    const [model] = browsing([summary(1)]);
    const [open] = update(model, { type: "movePickerOpened" });
    const [moved] = update(open, { type: "movePickerMoved", delta: 2 });
    const [closed, effects] = update(moved, { type: "movePickerClosed" });
    expect(closed).toEqual(model);
    expect(effects).toEqual([]);
  });

  test("picking the current state closes the picker and sends nothing", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "To Do");
    expect(picked).toEqual(model);
    expect(effects).toEqual([]);
  });

  test("query editing and help do not open over the picker", () => {
    const [model] = browsing([summary(1)]);
    const [open] = update(model, { type: "movePickerOpened" });
    expect(update(open, { type: "queryEditStarted" })[0]).toBe(open);
    expect(update(open, { type: "helpOpened" })[0]).toBe(open);
  });
});

describe("moving a story", () => {
  test("picking another state sends one PATCH and shows the story in its new group at once, still selected", () => {
    const [model] = browsing([summary(1), inState(summary(2), doing)]);
    const [onFirst] = update(model, { type: "selectionMoved", delta: 1 });
    expect(onFirst.selectedStoryId).toBe(storyId(1));
    const [picked, effects] = pick(onFirst, "Finished");
    expect(only(effects, "moveStory")).toMatchObject({ storyId: storyId(1), stateId: finished.id });
    expect(shown(picked).map((story) => story.id)).toEqual([storyId(1), storyId(2)]);
    expect(stateOf(picked, 1)).toBe("Finished");
    expect(picked.selectedStoryId).toBe(storyId(1));
    expect(picked.moves.get(storyId(1))?.status).toBe("saving");
    expect(picked.focus).toEqual({ mode: "browsing" });
  });

  test("a success replaces the story with the server's version and ends the saving marker", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "Finished");
    const move = only(effects, "moveStory");
    const [done, doneEffects] = succeed(picked, move, serverStory(move, "Story 1 (renamed)"));
    expect(doneEffects).toEqual([]);
    expect(shown(done)[0]).toEqual(serverStory(move, "Story 1 (renamed)"));
    expect(done.moves.get(storyId(1))?.status).not.toBe("saving");
  });

  test("a failure reverts the story to the state the server last reported and keeps the message", () => {
    const [model] = browsing([summary(1), inState(summary(2), doing)]);
    const [onFirst] = update(model, { type: "selectionMoved", delta: 1 });
    const [picked, effects] = pick(onFirst, "Finished");
    const [failed, failEffects] = fail(picked, only(effects, "moveStory"), "Shortcut API 422");
    expect(failEffects).toEqual([]);
    expect(stateOf(failed, 1)).toBe("To Do");
    expect(shown(failed).map((story) => story.id)).toEqual([storyId(2), storyId(1)]);
    expect(failed.moves.get(storyId(1))).toMatchObject({
      status: "failed",
      message: "Shortcut API 422",
    });
  });

  test("a response for a request that is no longer in flight is dropped", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "Finished");
    const move = only(effects, "moveStory");
    const [done] = succeed(picked, move);
    const [again, againEffects] = succeed(done, move);
    expect(again).toBe(done);
    expect(againEffects).toEqual([]);
    const [failedLate, lateEffects] = fail(done, move);
    expect(failedLate).toBe(done);
    expect(lateEffects).toEqual([]);
  });

  test("picks while a move is saving replace one pending intent, sent when the move succeeds", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "Finished");
    const firstMove = only(effects, "moveStory");
    const [second, secondEffects] = pick(picked, "Doing");
    expect(secondEffects).toEqual([]);
    expect(stateOf(second, 1)).toBe("Doing");
    const [third, thirdEffects] = pick(second, "To Do");
    expect(thirdEffects).toEqual([]);
    expect(stateOf(third, 1)).toBe("To Do");

    const [settled, settledEffects] = succeed(third, firstMove);
    const followUp = only(settledEffects, "moveStory");
    expect(followUp).toMatchObject({ storyId: storyId(1), stateId: toDo.id });
    expect(followUp.requestId).not.toBe(firstMove.requestId);
    expect(stateOf(settled, 1)).toBe("To Do");
    expect(settled.moves.get(storyId(1))?.status).toBe("saving");

    const [done, doneEffects] = succeed(settled, followUp);
    expect(doneEffects).toEqual([]);
    expect(stateOf(done, 1)).toBe("To Do");
    expect(done.moves.get(storyId(1))?.status).not.toBe("saving");
  });

  test("a pending intent that matches the confirmed state is not sent", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "Finished");
    const [second] = pick(picked, "Doing");
    const [third] = pick(second, "Finished");
    const [done, doneEffects] = succeed(third, only(effects, "moveStory"));
    expect(doneEffects).toEqual([]);
    expect(stateOf(done, 1)).toBe("Finished");
    expect(done.moves.get(storyId(1))?.status).not.toBe("saving");
  });

  test("a queued pick refused after the move before it was confirmed shows the confirmed state, not the starting one", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "Finished");
    const [second, secondEffects] = pick(picked, "Doing");
    expect(secondEffects).toEqual([]);
    const [confirmed, confirmedEffects] = succeed(second, only(effects, "moveStory"));
    const queued = only(confirmedEffects, "moveStory");
    expect(queued).toMatchObject({ storyId: storyId(1), stateId: doing.id });
    const [refused] = fail(confirmed, queued, "nope");
    expect(stateOf(refused, 1)).toBe("Finished");
    expect(refused.moves.get(storyId(1))).toMatchObject({ status: "failed", message: "nope" });
  });

  test("a pending intent is still sent when the move before it fails", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "Finished");
    const [second] = pick(picked, "Doing");
    const [settled, settledEffects] = fail(second, only(effects, "moveStory"));
    const followUp = only(settledEffects, "moveStory");
    expect(followUp).toMatchObject({ storyId: storyId(1), stateId: doing.id });
    expect(stateOf(settled, 1)).toBe("Doing");
    const [failed] = fail(settled, followUp, "nope");
    expect(stateOf(failed, 1)).toBe("To Do");
    expect(failed.moves.get(storyId(1))).toMatchObject({ status: "failed", message: "nope" });
  });

  test("moves on different stories are in flight at the same time", () => {
    const [model] = browsing([summary(1), summary(2)]);
    const [firstPicked, firstEffects] = pick(model, "Finished");
    const [onSecond] = update(firstPicked, { type: "selectionMoved", delta: 1 });
    expect(onSecond.selectedStoryId).toBe(storyId(2));
    const [bothPicked, secondEffects] = pick(onSecond, "Doing");
    const firstMove = only(firstEffects, "moveStory");
    const secondMove = only(secondEffects, "moveStory");
    expect([firstMove.storyId, secondMove.storyId]).toEqual([storyId(1), storyId(2)]);
    expect(bothPicked.moves.get(storyId(1))?.status).toBe("saving");
    expect(bothPicked.moves.get(storyId(2))?.status).toBe("saving");
    const [secondDone] = succeed(bothPicked, secondMove);
    expect(secondDone.moves.get(storyId(1))?.status).toBe("saving");
    expect(secondDone.moves.get(storyId(2))?.status).not.toBe("saving");
    expect(stateOf(secondDone, 1)).toBe("Finished");
    expect(stateOf(secondDone, 2)).toBe("Doing");
  });
});

describe("moves and search results", () => {
  test("results that load while a move is saving show the target, and a failure then reverts to what those results reported", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "Finished");
    const move = only(effects, "moveStory");
    const [refreshing, refreshEffects] = update(picked, { type: "refreshRequested" });
    const [refreshed] = answer(refreshing, first(refreshEffects, "searchStories"), [
      inState(summary(1), doing),
    ]);
    expect(stateOf(refreshed, 1)).toBe("Finished");
    const [failed] = fail(refreshed, move);
    expect(stateOf(failed, 1)).toBe("Doing");
  });

  test("a refresh sent before the move settled cannot undo it, even when answered later", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "Finished");
    const [refreshing, refreshEffects] = update(picked, { type: "refreshRequested" });
    const stale = first(refreshEffects, "searchStories");
    const [done] = succeed(refreshing, only(effects, "moveStory"));
    const [afterStale] = answer(done, stale, [summary(1)]);
    expect(stateOf(afterStale, 1)).toBe("Finished");
  });

  test("an auto-refresh sent mid-move keeps the picked state whether it is answered before or after the move settles", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "Finished");
    const [refreshing, refreshEffects] = update(picked, { type: "autoRefreshDue" });
    const stale = first(refreshEffects, "searchStories");
    const [refreshed] = answer(refreshing, stale, [summary(1)]);
    expect(stateOf(refreshed, 1)).toBe("Finished");
    const [done] = succeed(refreshed, only(effects, "moveStory"));
    expect(stateOf(done, 1)).toBe("Finished");
    const [settledFirst] = succeed(refreshing, only(effects, "moveStory"));
    const [answeredLate] = answer(settledFirst, stale, [summary(1)]);
    expect(stateOf(answeredLate, 1)).toBe("Finished");
  });

  test("a refresh closes the picker", () => {
    const [model] = browsing([summary(1)]);
    const [open] = update(model, { type: "movePickerOpened" });
    const [refreshing] = update(open, { type: "refreshRequested" });
    expect(refreshing.focus).toEqual({ mode: "browsing" });
  });

  test("a refresh sent after the move settled is believed, even when it disagrees", () => {
    const [model] = browsing([summary(1)]);
    const [picked, effects] = pick(model, "Finished");
    const [done] = succeed(picked, only(effects, "moveStory"));
    const [refreshing, refreshEffects] = update(done, { type: "refreshRequested" });
    const [refreshed] = answer(refreshing, first(refreshEffects, "searchStories"), [
      inState(summary(1), doing),
    ]);
    expect(stateOf(refreshed, 1)).toBe("Doing");
    expect(refreshed.moves.has(storyId(1))).toBe(false);
  });

  test("the picker closes when a refresh drops its story", () => {
    const [model] = browsing([summary(1), summary(2)]);
    const [open] = update(model, { type: "movePickerOpened" });
    const [refreshing, refreshEffects] = update(open, { type: "refreshRequested" });
    const [refreshed] = answer(refreshing, first(refreshEffects, "searchStories"), [summary(2)]);
    expect(refreshed.focus).toEqual({ mode: "browsing" });
  });
});
