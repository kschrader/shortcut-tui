import { expect, test } from "bun:test";
import { createFakeShortcutClient } from "../shortcut/fake.ts";
import { createFakeGitHubClient } from "./fake.ts";
import { storyMergeStatus } from "./pull-request-state.ts";
import { pullRequestKey } from "./types.ts";

test("every demo pull request has a GitHub state and the demo stories show varied statuses", async () => {
  const shortcut = createFakeShortcutClient();
  const github = createFakeGitHubClient();
  const stories = await shortcut.searchStories("");
  const statuses = await Promise.all(
    stories.map(async (story) => {
      const refs = (await shortcut.listPullRequests(story.id)).flatMap((pr) =>
        pr.github === null ? [] : [pr.github],
      );
      const states = await github.pullRequestStates(refs);
      return storyMergeStatus(refs.map((ref) => states.get(pullRequestKey(ref)) ?? "unknown"));
    }),
  );
  expect(statuses).not.toContain("unknown");
  expect(new Set(statuses)).toEqual(
    new Set(["none", "merged", "ready", "checks-failing", "draft", "changes-requested"]),
  );
});
