import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import type { Cached, PullRequestView, StoryPullRequests } from "../app/model.ts";
import { queryQuestion } from "../app/filters.ts";
import type { PullRequestState } from "../github/types.ts";
import type { PullRequestId } from "../shortcut/types.ts";
import {
  browsing,
  cached,
  cleanup,
  detail,
  reloading,
  loaded,
  reloadFailed,
  requestId,
  settled,
  show,
  storyId,
  summary,
} from "./frame.tsx";

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

const checked: StoryPullRequests = new Map([
  [
    storyId(101),
    settled<readonly PullRequestView[]>([
      view(3917, "ready", "Forward the next param through SSO"),
      view(3911, "merged", "Add a redirect test"),
    ]),
  ],
  [
    storyId(102),
    settled<readonly PullRequestView[]>([view(3939, "conflicts", "Add a dark theme")]),
  ],
]);

const withPullRequests = (
  pullRequests: Cached<StoryPullRequests> = cached(checked),
  selected = 101,
) =>
  browsing({
    results: loaded({ question: queryQuestion("owner:me"), stories: linked }),
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
  const { frame } = await show(withPullRequests(cached(checked), 103));
  expect(frame()).not.toContain("Pull requests");
});

test("while GitHub is checked, rows show a checking mark and the detail says so", async () => {
  const { frame } = await show(withPullRequests(cached(new Map(), reloading(requestId(4)))));
  expect(rowOf(frame(), 101)).toContain("… checking");
  expect(rowOf(frame(), 103)).not.toContain("…");
  expect(frame()).toContain("Pull requests (2)");
  expect(frame()).toContain("checking GitHub…");
});

test("without the gh CLI the detail pane says how to set it up", async () => {
  const { frame } = await show(
    withPullRequests(
      cached(new Map(), reloadFailed("GitHub status needs the gh CLI: gh auth login")),
    ),
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
      results: loaded({ question: queryQuestion("owner:me"), stories: [story] }),
      selectedStoryId: story.id,
      details: new Map(),
      pullRequests: cached(
        new Map([
          [story.id, settled<readonly PullRequestView[]>([view(3917, "conflicts", "Toggle")])],
        ]),
      ),
    }),
    { width: 80 },
  );
  const row = rowOf(frame(), 316665);
  expect(row).toContain("Add option to limit GitHub PR auto-");
  expect(row).toContain("≠");
  expect(row).not.toContain("conflicts");
});

test("p opens the pull request that decides the badge", async () => {
  const { screen, calls } = await show(withPullRequests());
  screen.mockInput.pressKey("p");
  expect(calls.opened).toEqual(["https://github.com/useshortcut/monorepo/pull/3917"]);
});

test("p opens the least ready pull request of the selected story", async () => {
  const { screen, calls } = await show(withPullRequests(cached(checked), 102));
  screen.mockInput.pressKey("p");
  expect(calls.opened).toEqual(["https://github.com/useshortcut/monorepo/pull/3939"]);
});

test("p does nothing for a story without pull requests or before status loads", async () => {
  const none = await show(withPullRequests(cached(checked), 103));
  none.screen.mockInput.pressKey("p");
  expect(none.calls.opened).toEqual([]);
  cleanup();
  const checking = await show(withPullRequests(cached(new Map(), reloading(requestId(4)))));
  checking.screen.mockInput.pressKey("p");
  expect(checking.calls.opened).toEqual([]);
});

test("p opens the kept pull request and the row keeps its badge while status reloads", async () => {
  const { screen, calls, frame } = await show(
    withPullRequests(cached(checked, reloading(requestId(4)))),
  );
  expect(rowOf(frame(), 101)).toMatch(/Fix login redirect\s+✓ ready/);
  screen.mockInput.pressKey("p");
  expect(calls.opened).toEqual(["https://github.com/useshortcut/monorepo/pull/3917"]);
});

test("a story whose pull requests could not be listed shows unknown and says why", async () => {
  const partly: StoryPullRequests = new Map([
    ...checked,
    [storyId(101), { status: "failed", message: "Shortcut API 429" } as const],
  ]);
  const { frame } = await show(withPullRequests(cached(partly)), { height: 40 });
  const text = frame();
  expect(rowOf(text, 101)).toContain("? unknown");
  expect(rowOf(text, 102)).toContain("≠ conflicts");
  expect(text).toContain("Shortcut API 429");
});

const statusBar = (frame: string) => frame.trimEnd().split("\n").at(-1) ?? "";

test("a failed pull request load shows in the status bar at 80 columns whatever is selected", async () => {
  const { frame } = await show(
    withPullRequests(
      cached(new Map(), reloadFailed("GitHub status needs the gh CLI: gh auth login")),
      103,
    ),
    { width: 80 },
  );
  const text = frame();
  for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(80);
  expect(statusBar(text)).toContain(
    "PR status: GitHub status needs the gh CLI: gh auth login  ·  r to retry",
  );
});

test("stories whose pull requests could not be listed are counted in the status bar", async () => {
  const partly: StoryPullRequests = new Map([
    [storyId(101), { status: "failed", message: "Shortcut API 429" } as const],
    [storyId(102), { status: "failed", message: "Shortcut API 429" } as const],
  ]);
  const { frame } = await show(withPullRequests(cached(partly), 103), { width: 80 });
  expect(statusBar(frame())).toContain("PR status for 2 stories: Shortcut API 429  ·  r to retry");
});

test("the status bar keeps its key hints while pull request status is fine or loading", async () => {
  const fine = await show(withPullRequests(cached(checked), 103), { width: 80 });
  expect(statusBar(fine.frame())).not.toContain("PR status");
  cleanup();
  const checking = await show(withPullRequests(cached(new Map(), reloading(requestId(4)))));
  expect(statusBar(checking.frame())).not.toContain("PR status");
});
