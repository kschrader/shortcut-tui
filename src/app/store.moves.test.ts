import { expect, test } from "bun:test";
import { createFakeGitHubClient } from "../github/fake.ts";
import { createFakeShortcutClient } from "../shortcut/fake.ts";
import type { StoryId } from "../shortcut/types.ts";
import { createFakeClock } from "./fake-clock.ts";
import { shownStories } from "./rows.ts";
import { createStoryStore } from "./store.ts";

const until = async (settled: () => boolean) => {
  for (let turn = 0; turn < 100 && !settled(); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(settled()).toBe(true);
};

const started = async () => {
  const shortcut = createFakeShortcutClient();
  const store = createStoryStore(
    { shortcut, github: createFakeGitHubClient() },
    { clock: createFakeClock(new Date("2026-11-02T09:00:00Z")), autoRefresh: { mode: "off" } },
  );
  const stop = store.start();
  await until(() => store.getModel().selectedStoryId !== null);
  const { workspace, selectedStoryId } = store.getModel();
  if (workspace.status !== "loaded" || selectedStoryId === null) throw new Error("not loaded");
  const stateNamed = (name: string) => {
    const state = workspace.value.workflowStates.find((candidate) => candidate.name === name);
    if (state === undefined) throw new Error(`the demo workspace has no state ${name}`);
    return state;
  };
  const pickLastState = async (storyId: StoryId) => {
    store.dispatch({ type: "movePickerOpened" });
    store.dispatch({ type: "movePickerMoved", delta: workspace.value.workflowStates.length });
    store.dispatch({ type: "movePickerConfirmed" });
    await until(() => store.getModel().moves.get(storyId)?.status !== "saving");
  };
  const shown = (storyId: StoryId) =>
    shownStories(store.getModel()).find((story) => story.id === storyId)?.state.name;
  return { shortcut, store, stop, storyId: selectedStoryId, stateNamed, pickLastState, shown };
};

test("a pick made after a teammate moved the story is not written, and the story shows where the teammate put it", async () => {
  const { shortcut, store, stop, storyId, stateNamed, pickLastState, shown } = await started();
  expect(shown(storyId)).toBe("In Review");
  await shortcut.moveStory(storyId, stateNamed("In Progress").id);

  await pickLastState(storyId);

  expect((await shortcut.getStorySummary(storyId)).state.name).toBe("In Progress");
  expect(shown(storyId)).toBe("In Progress");
  expect(store.getModel().moves.get(storyId)?.status).toBe("failed");
  stop();
});

test("a pick on a story nobody else moved is written", async () => {
  const { shortcut, store, stop, storyId, pickLastState } = await started();

  await pickLastState(storyId);

  expect((await shortcut.getStorySummary(storyId)).state.name).toBe("Done");
  expect(store.getModel().moves.get(storyId)?.status).toBe("moved");
  stop();
});
