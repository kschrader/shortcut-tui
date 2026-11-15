import { expect, test } from "bun:test";
import { defaultQueryFor, queriesFor, withoutFloor } from "../app/filters.ts";
import { createFakeShortcutClient } from "./fake.ts";
import { storyId, workflowStateId } from "./schemas.ts";

test("stories span every progress and carry owner and state names", async () => {
  const stories = await createFakeShortcutClient().searchStories("");
  expect(stories.length).toBeGreaterThanOrEqual(8);
  expect(new Set(stories.map((story) => story.state.progress))).toEqual(
    new Set(["unstarted", "started", "done"]),
  );
  for (const story of stories) {
    expect(story.state.name).not.toBe("");
    for (const owner of story.owners) expect(owner.name).not.toBe("");
  }
});

test("the app's default query returns only my in-progress stories", async () => {
  const client = createFakeShortcutClient();
  const workspace = await client.loadWorkspace();
  const { me } = workspace;
  const all = await client.searchStories("");
  const [query = ""] = queriesFor(withoutFloor(defaultQueryFor(me.mentionName)), workspace);
  const mine = await client.searchStories(query);
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.length).toBeLessThan(all.length);
  for (const story of mine) {
    expect(story.owners.map((owner) => owner.id)).toContain(me.id);
    expect(story.state.progress).toBe("started");
  }
});

test("the review filter finds stories other people own in a review state", async () => {
  const client = createFakeShortcutClient();
  const workspace = await client.loadWorkspace();
  const queries = queriesFor(withoutFloor({ kind: "inReview" }), workspace);
  const found = (await Promise.all(queries.map((query) => client.searchStories(query)))).flat();
  expect(found.map((story) => story.name).toSorted()).toEqual([
    "Fix flaky label sync test",
    "Paginate the iteration list",
  ]);
});

test("has:pr keeps the stories that link a pull request and !has:pr the rest", async () => {
  const client = createFakeShortcutClient();
  const all = await client.searchStories("");
  const linking = await client.searchStories("has:pr");
  const unlinked = await client.searchStories("!has:pr");
  expect(linking.length).toBeGreaterThan(0);
  expect(unlinked.length).toBeGreaterThan(0);
  expect(linking.every((story) => story.pullRequestCount > 0)).toBe(true);
  expect(unlinked.every((story) => story.pullRequestCount === 0)).toBe(true);
  expect(linking.length + unlinked.length).toBe(all.length);
});

test("free text narrows by story name", async () => {
  const byText = await createFakeShortcutClient().searchStories("webhook");
  expect(byText.map((story) => story.name)).toEqual(["Document webhook retry behavior"]);
});

test("summaries do not carry detail fields and getStory returns them", async () => {
  const client = createFakeShortcutClient();
  const [first] = await client.searchStories("owner:me");
  if (first === undefined) throw new Error("expected a story");
  expect("comments" in first).toBe(false);
  expect("checklist" in first).toBe(false);
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

test("getStorySummary returns the story as a search would, in the state a move left it, and rejects for an unknown id", async () => {
  const client = createFakeShortcutClient();
  const { workflowStates } = await client.loadWorkspace();
  const [story] = await client.searchStories("owner:me is:started");
  if (story === undefined) throw new Error("expected a started story");
  expect(await client.getStorySummary(story.id)).toEqual(story);
  const done = workflowStates.find((state) => state.progress === "done");
  if (done === undefined) throw new Error("expected a done state");
  await client.moveStory(story.id, done.id);
  expect((await client.getStorySummary(story.id)).state).toEqual(done);
  const outcome = await client.getStorySummary(storyId.parse(1)).then(
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

test("stories that link pull requests list exactly as many as their summary counts", async () => {
  const client = createFakeShortcutClient();
  const stories = await client.searchStories("");
  const linked = await Promise.all(stories.map((story) => client.listPullRequests(story.id)));
  expect(linked.map((prs) => prs.length)).toEqual(stories.map((story) => story.pullRequestCount));
  expect(linked.flat().length).toBeGreaterThanOrEqual(5);
  for (const pr of linked.flat()) {
    expect(pr.github === null).toBe(!pr.url.startsWith("https://github.com/"));
  }
});

test("the demo workspace can write and lists the states a story can move to", async () => {
  const workspace = await createFakeShortcutClient().loadWorkspace();
  expect(workspace.canWrite).toBe(true);
  expect(workspace.workflowStates.map((state) => state.name)).toEqual([
    "Backlog",
    "Ready for Development",
    "In Progress",
    "In Review",
    "Done",
  ]);
});

test("moveStory changes the state that later searches and getStory report, for that client only", async () => {
  const client = createFakeShortcutClient();
  const other = createFakeShortcutClient();
  const { workflowStates } = await client.loadWorkspace();
  const [story] = await client.searchStories("owner:me is:started");
  if (story === undefined) throw new Error("expected a started story");
  const done = workflowStates.find((state) => state.progress === "done");
  if (done === undefined) throw new Error("expected a done state");

  const moved = await client.moveStory(story.id, done.id);
  expect(moved.id).toBe(story.id);
  expect(moved.state).toEqual(done);
  expect(moved.updatedAt.getTime()).toBeGreaterThan(story.updatedAt.getTime());
  expect((await client.getStory(story.id)).state).toEqual(done);
  expect((await client.searchStories("owner:me is:started")).map((s) => s.id)).not.toContain(
    story.id,
  );
  expect((await other.getStory(story.id)).state).toEqual(story.state);
});

test("moveStory rejects an unknown state with a 422 and leaves the story alone", async () => {
  const client = createFakeShortcutClient();
  const [story] = await client.searchStories("owner:me");
  if (story === undefined) throw new Error("expected a story");
  const { message } = await client.moveStory(story.id, workflowStateId.parse(1)).then(
    () => ({ message: "resolved" }),
    (error: unknown) => ({ message: error instanceof Error ? error.message : "non-error" }),
  );
  expect(message).toContain("422");
  expect(message).toContain(`/stories/${story.id}`);
  expect((await client.getStory(story.id)).state).toEqual(story.state);
});

test("an injected failure rejects the move with its message and leaves the story alone", async () => {
  const client = createFakeShortcutClient({
    failMove: (story, target) => `cannot move ${story.name} to ${target.name}`,
  });
  const { workflowStates } = await client.loadWorkspace();
  const [story] = await client.searchStories("owner:me");
  const target = workflowStates[0];
  if (story === undefined || target === undefined) throw new Error("expected fixtures");
  const message = await client.moveStory(story.id, target.id).then(
    () => "resolved",
    (error: unknown) => (error instanceof Error ? error.message : "non-error"),
  );
  expect(message).toBe(`cannot move ${story.name} to ${target.name}`);
  expect((await client.getStory(story.id)).state).toEqual(story.state);
});

test("moveDelayMs delays moves without delaying reads", async () => {
  const client = createFakeShortcutClient({ moveDelayMs: 40 });
  const { workflowStates } = await client.loadWorkspace();
  const [story] = await client.searchStories("owner:me");
  const target = workflowStates[0];
  if (story === undefined || target === undefined) throw new Error("expected fixtures");
  const readStart = performance.now();
  await client.getStory(story.id);
  expect(performance.now() - readStart).toBeLessThan(30);
  const moveStart = performance.now();
  await client.moveStory(story.id, target.id);
  expect(performance.now() - moveStart).toBeGreaterThanOrEqual(35);
});

test("with teammateMovesOnRefresh, asking the same query again finds a teammate moved a story once", async () => {
  const client = createFakeShortcutClient({ teammateMovesOnRefresh: true });
  const workspace = await client.loadWorkspace();
  const [query = ""] = queriesFor(
    withoutFloor(defaultQueryFor(workspace.me.mentionName)),
    workspace,
  );
  const before = await client.searchStories(query);
  const after = await client.searchStories(query);
  const again = await client.searchStories(query);
  const shown = (stories: typeof before) =>
    stories.find((story) => story.id === storyId.parse(1001));
  expect(shown(before)?.state.name).toBe("In Progress");
  expect(shown(after)?.state.name).toBe("In Review");
  expect(shown(after)?.updatedAt.getTime()).toBeGreaterThan(
    shown(before)?.updatedAt.getTime() ?? 0,
  );
  expect(shown(again)).toEqual(shown(after));
});

test("without teammateMovesOnRefresh, asking again finds the same stories", async () => {
  const client = createFakeShortcutClient();
  expect(await client.searchStories("")).toEqual(await client.searchStories(""));
});

test("moved:*..DAY keeps the stories that moved into their state on or before that day", async () => {
  const client = createFakeShortcutClient();
  const named = async (query: string) =>
    (await client.searchStories(query)).map((story) => story.name).toSorted();
  expect(await named("moved:*..2026-09-14")).toEqual(["Document webhook retry behavior"]);
  expect(await named("moved:*..2026-09-13")).toEqual([]);
  expect(await named("moved:*..2026-09-25")).toEqual([
    "Document webhook retry behavior",
    "Fix flaky label sync test",
  ]);
});

test("a parent's detail lists its sub-tasks as they stand now, and a child points back at it", async () => {
  const client = createFakeShortcutClient();
  const parentId = storyId.parse(1016);
  const child = storyId.parse(1018);
  const before = await client.getStory(parentId);
  expect(before.subTaskCount).toBe(4);
  expect(before.subTasks.map((story) => story.id)).toContain(child);
  const inChild = before.subTasks.find((story) => story.id === child);
  expect(inChild?.parent?.id).toBe(parentId);
  const finished = workflowStateId.parse(500000005);
  await client.moveStory(child, finished);
  const after = await client.getStory(parentId);
  expect(after.subTasks.find((story) => story.id === child)?.state.id).toBe(finished);
});
