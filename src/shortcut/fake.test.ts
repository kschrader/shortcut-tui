import { expect, test } from "bun:test";
import { createFakeShortcutClient } from "./fake.ts";
import { storyId } from "./schemas.ts";

test("workspace has me, members and states across all kinds", async () => {
  const workspace = await createFakeShortcutClient().loadWorkspace();
  expect(workspace.members.get(workspace.me.id)).toEqual(workspace.me);
  const kinds = new Set([...workspace.workflowStates.values()].map((state) => state.kind));
  expect(kinds).toEqual(new Set(["unstarted", "started", "done"]));
});

test("every story references known members and states", async () => {
  const client = createFakeShortcutClient();
  const workspace = await client.loadWorkspace();
  const stories = await client.searchStories("");
  expect(stories.length).toBeGreaterThanOrEqual(8);
  for (const story of stories) {
    expect(workspace.workflowStates.has(story.workflowStateId)).toBe(true);
    for (const ownerId of story.ownerIds) expect(workspace.members.has(ownerId)).toBe(true);
  }
});

test("the search query narrows by owner, open state and text", async () => {
  const client = createFakeShortcutClient();
  const workspace = await client.loadWorkspace();
  const mine = await client.searchStories("owner:me !is:done");
  expect(mine.length).toBeGreaterThan(0);
  for (const story of mine) {
    expect(story.ownerIds).toContain(workspace.me.id);
    expect(workspace.workflowStates.get(story.workflowStateId)?.kind).not.toBe("done");
  }
  const byText = await client.searchStories("webhook");
  expect(byText.map((story) => story.name)).toEqual(["Document webhook retry behavior"]);
});

test("summaries do not carry detail fields and getStory returns them", async () => {
  const client = createFakeShortcutClient();
  const [first] = await client.searchStories("owner:me");
  if (first === undefined) throw new Error("expected a story");
  expect("comments" in first).toBe(false);
  const detail = await client.getStory(first.id);
  expect(detail.name).toBe(first.name);
  expect(detail.description.length).toBeGreaterThan(0);
});

test("getStory rejects for an unknown id", async () => {
  const outcome = await createFakeShortcutClient()
    .getStory(storyId.parse(1))
    .then(
      () => "resolved",
      () => "rejected",
    );
  expect(outcome).toBe("rejected");
});

test("delayMs delays every call", async () => {
  const client = createFakeShortcutClient({ delayMs: 40 });
  const started = performance.now();
  await client.loadWorkspace();
  expect(performance.now() - started).toBeGreaterThanOrEqual(35);
});
