import { expect, test } from "bun:test";
import { z } from "zod";
import { runEffect } from "../app/effects.ts";
import type { RequestId } from "../app/model.ts";
import { idle } from "../app/remote.ts";
import { createFakeShortcutClient } from "../shortcut/fake.ts";
import { badgeStyle, storyBadge } from "../ui/pull-requests.ts";
import { createFakeGitHubClient } from "./fake.ts";

const demoPullRequests = async () => {
  const shortcut = createFakeShortcutClient();
  const stories = await shortcut.searchStories("");
  const msg = await runEffect(
    { shortcut, github: createFakeGitHubClient() },
    {
      type: "loadPullRequests",
      requestId: z.custom<RequestId>().parse(1),
      storyIds: stories.filter((story) => story.pullRequestCount > 0).map((story) => story.id),
    },
    () => new Date(0),
  );
  if (msg.type !== "pullRequestsLoaded") throw new Error(`expected a load, got ${msg.type}`);
  return { stories, pullRequests: { value: msg.pullRequests, reload: idle } };
};

test("the demo shows every pull request badge", async () => {
  const { pullRequests } = await demoPullRequests();
  const shown = new Set(
    [...pullRequests.value.values()].flatMap((list) =>
      list.status === "loaded" ? list.value.map((pr) => pr.state) : [],
    ),
  );
  const badges = Object.keys(badgeStyle).filter((badge) => badge !== "checking");
  expect(new Set<string>(shown)).toEqual(new Set(badges));
});

test("the demo list shows behind, blocked, and unknown story badges", async () => {
  const { stories, pullRequests } = await demoPullRequests();
  const rows = new Set(stories.map((story) => storyBadge(story, pullRequests)));
  for (const badge of ["behind", "blocked", "unknown", "merged", "conflicts"] as const) {
    expect(rows).toContain(badge);
  }
});

test("the demo has a pull request that needs review while an optional check fails", async () => {
  const { pullRequests } = await demoPullRequests();
  const waiting = [...pullRequests.value.values()].flatMap((list) =>
    list.status === "loaded"
      ? list.value.filter((pr) => pr.state === "needs-review" && pr.optionalFailing.length > 0)
      : [],
  );
  expect(waiting.map((pr) => pr.optionalFailing)).toEqual([["pr-preview"]]);
});
