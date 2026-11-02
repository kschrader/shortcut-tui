import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import type { PullRequestView, StoryPullRequests } from "../app/model.ts";
import type { PullRequestState } from "../github/types.ts";
import type { PullRequestId, StoryId } from "../shortcut/types.ts";
import { browsing, cleanup, detail, loaded, requestId, show, storyId, summary } from "./frame.tsx";

afterEach(cleanup);

const view = (number: number, state: PullRequestState, title: string): PullRequestView => ({
  id: z.custom<PullRequestId>().parse(number),
  title,
  url: `https://github.com/useshortcut/monorepo/pull/${String(number)}`,
  closed: false,
  draft: false,
  github: { owner: "useshortcut", repo: "monorepo", number },
  state,
});

const linked = [
  summary(101, { name: "Fix login redirect", pullRequestCount: 2 }),
  summary(102, { name: "Add dark mode", pullRequestCount: 1 }),
  summary(103, { name: "Rotate API keys" }),
];

const checked: StoryPullRequests = new Map<StoryId, PullRequestView[]>([
  [
    storyId(101),
    [
      view(3917, "ready", "Forward the next param through SSO"),
      view(3911, "merged", "Add a redirect test"),
    ],
  ],
  [storyId(102), [view(3939, "conflicts", "Add a dark theme")]],
]);

const withPullRequests = (pullRequests = loaded(checked), selected = 101) =>
  browsing({
    results: loaded({ query: "owner:me", stories: linked }),
    selectedStoryId: storyId(selected),
    details: new Map([[storyId(selected), loaded({ ...detail, ...linked[0] })]]),
    pullRequests,
  });

const rowOf = (frame: string, id: number) =>
  frame.split("\n").find((line) => line.includes(` ${String(id)} `)) ?? "";

test("each row shows its story's merge status after the name", async () => {
  const { frame } = await show(withPullRequests());
  expect(rowOf(frame(), 101)).toMatch(/Fix login redirect\s+✓ ready/);
  expect(rowOf(frame(), 102)).toMatch(/Add dark mode\s+≠ conflicts/);
  expect(rowOf(frame(), 103)).toMatch(/Rotate API keys\s+3 │/);
});

test("the detail pane lists each pull request with its number, state and title", async () => {
  const { frame } = await show(withPullRequests(), { height: 40 });
  const text = frame();
  expect(text).toContain("Pull requests (2)");
  expect(text).toMatch(/#3917\s+✓ ready to merge/);
  expect(text).toContain("Forward the next param through SSO");
  expect(text).toMatch(/#3911\s+◉ merged/);
  expect(text).toContain("Add a redirect test");
});

test("a story without pull requests has no pull request section", async () => {
  const { frame } = await show(withPullRequests(loaded(checked), 103));
  expect(frame()).not.toContain("Pull requests");
});

test("while GitHub is checked, rows show a checking mark and the detail says so", async () => {
  const { frame } = await show(withPullRequests({ status: "loading", requestId: requestId(4) }));
  expect(rowOf(frame(), 101)).toContain("… checking");
  expect(rowOf(frame(), 103)).not.toContain("…");
  expect(frame()).toContain("Pull requests (2)");
  expect(frame()).toContain("checking GitHub…");
});

test("without the gh CLI the detail pane says how to set it up", async () => {
  const { frame } = await show(
    withPullRequests({
      status: "failed",
      message: "GitHub status needs the gh CLI: gh auth login",
    }),
  );
  const text = frame();
  expect(text).toContain("GitHub status needs the gh CLI: gh auth login");
  expect(text).toContain("press r to retry");
  expect(rowOf(text, 101)).not.toContain("checking");
});

test("an 80-column terminal keeps names readable and shows the status as a glyph", async () => {
  const longName = "Add option to limit GitHub PR auto-linking to the first story mention";
  const story = summary(316665, { name: longName, pullRequestCount: 1 });
  const { frame } = await show(
    browsing({
      results: loaded({ query: "owner:me", stories: [story] }),
      selectedStoryId: story.id,
      details: new Map(),
      pullRequests: loaded(new Map([[story.id, [view(3917, "conflicts", "Toggle")]]])),
    }),
    { width: 80 },
  );
  const row = rowOf(frame(), 316665);
  expect(row).toContain("Add option to limit GitHub PR auto-");
  expect(row).toContain("≠");
  expect(row).not.toContain("conflicts");
});
