import { expect, test } from "bun:test";
import type { StoryDetail } from "../shortcut/types.ts";
import { detail, doing, inState, storyId, summary } from "./fixtures.ts";
import type { Model } from "./model.ts";
import { browsing, only } from "./steps.ts";
import { update } from "./update.ts";

const parent: StoryDetail = { ...detail(1), subTasks: [summary(2), summary(3)] };

const subTasksOf = (model: Model) => {
  const shown = model.details.get(storyId(1));
  if (shown?.status !== "loaded") throw new Error("the parent's detail is not loaded");
  return shown.value.subTasks.map((story) => [story.id, story.state.name]);
};

const withParentLoaded = (): Model => {
  const [model, effects] = browsing([summary(1), summary(2), summary(3)]);
  const fetch = only(effects, "getStory");
  const [loaded] = update(model, {
    type: "detailSucceeded",
    requestId: fetch.requestId,
    story: parent,
  });
  const [onChild] = update(loaded, { type: "selectionMoved", delta: 1 });
  return onChild;
};

const pickDoing = (model: Model) => {
  const [open] = update(model, { type: "movePickerOpened" });
  const [moved] = update(open, { type: "movePickerMoved", delta: 1 });
  const [confirmed, effects] = update(moved, { type: "movePickerConfirmed" });
  return [confirmed, only(effects, "moveStory")] as const;
};

test("a sub-task's confirmed move shows its new state in its parent's sub-task section", () => {
  const [picked, move] = pickDoing(withParentLoaded());
  expect(subTasksOf(picked)).toEqual([
    [storyId(2), "To Do"],
    [storyId(3), "To Do"],
  ]);
  const [confirmed] = update(picked, {
    type: "moveSucceeded",
    requestId: move.requestId,
    storyId: storyId(2),
    story: inState(summary(2), doing),
  });
  expect(subTasksOf(confirmed)).toEqual([
    [storyId(2), "Doing"],
    [storyId(3), "To Do"],
  ]);
});

test("a sub-task's refused move leaves its parent's sub-task section as it was", () => {
  const [picked, move] = pickDoing(withParentLoaded());
  const [refused] = update(picked, {
    type: "moveFailed",
    requestId: move.requestId,
    storyId: storyId(2),
    message: "nope",
  });
  expect(subTasksOf(refused)).toEqual([
    [storyId(2), "To Do"],
    [storyId(3), "To Do"],
  ]);
});
