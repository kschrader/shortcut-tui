import { expect, test } from "bun:test";
import { defaultQueryFor } from "../app/update.ts";
import { createFakeShortcutClient } from "./fake.ts";
import { storyId } from "./schemas.ts";

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
  const { me } = await client.loadWorkspace();
  const all = await client.searchStories("");
  const mine = await client.searchStories(defaultQueryFor(me.mentionName));
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.length).toBeLessThan(all.length);
  for (const story of mine) {
    expect(story.owners.map((owner) => owner.id)).toContain(me.id);
    expect(story.state.progress).toBe("started");
  }
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

test("stories that link pull requests list exactly as many as their summary counts", async () => {
  const client = createFakeShortcutClient();
  const stories = await client.searchStories("");
  const linked = await Promise.all(stories.map((story) => client.listPullRequests(story.id)));
  expect(linked.map((prs) => prs.length)).toEqual(stories.map((story) => story.pullRequestCount));
  expect(linked.flat().length).toBeGreaterThanOrEqual(5);
  for (const pr of linked.flat()) expect(pr.github).not.toBeNull();
});
