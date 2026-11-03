import { expect, test } from "bun:test";
import { z } from "zod";
import type { PullRequestState } from "../github/types.ts";
import type { PullRequestId, StorySummary } from "../shortcut/types.ts";
import { doing, finished, inState, storyId, summary } from "./fixtures.ts";
import { changesBetween, glanceOf } from "./glance.ts";
import type {
  Cached,
  PullRequestView,
  Reload,
  RequestId,
  Settled,
  StoryPullRequests,
} from "./model.ts";
import { idle } from "./remote.ts";

const view = (number: number, state: PullRequestState): PullRequestView => ({
  id: z.custom<PullRequestId>().parse(number),
  title: `Pull request ${String(number)}`,
  url: `https://github.com/acme/app/pull/${String(number)}`,
  closed: false,
  draft: false,
  github: { owner: "acme", repo: "app", number },
  state,
});

const linked = (id: number, updatedAt = new Date(0)): StorySummary => ({
  ...summary(id),
  pullRequestCount: 1,
  updatedAt,
});

const prs = (
  entries: [number, Settled<readonly PullRequestView[]>][],
  reload: Reload = idle,
): Cached<StoryPullRequests> => ({
  value: new Map(entries.map(([id, list]) => [storyId(id), list] as const)),
  reload,
});

const showing = (...states: PullRequestState[]): Settled<readonly PullRequestView[]> => ({
  status: "loaded",
  value: states.map((state, index) => view(index + 1, state)),
});

const checking: Reload = { status: "inFlight", requestId: z.custom<RequestId>().parse(9) };

const noPrs = prs([]);

test("a story never seen is new", () => {
  expect(changesBetween(undefined, glanceOf(summary(1), noPrs))).toEqual([{ kind: "new" }]);
});

test("a story seen as it is now has no changes", () => {
  const story = linked(1);
  const known = prs([[1, showing("ready")]]);
  expect(changesBetween(glanceOf(story, known), glanceOf(story, known))).toEqual([]);
});

test("a new workflow state is a state change naming both states, not an edit", () => {
  const before = summary(1);
  const after = inState(before, doing, new Date(5_000));
  expect(changesBetween(glanceOf(before, noPrs), glanceOf(after, noPrs))).toEqual([
    { kind: "state", from: before.state, to: after.state },
  ]);
});

test("a later updatedAt with nothing else changed is an edit", () => {
  const before = summary(1);
  const after = { ...before, name: "Renamed", updatedAt: new Date(5_000) };
  expect(changesBetween(glanceOf(before, noPrs), glanceOf(after, noPrs))).toEqual([
    { kind: "edited" },
  ]);
});

test("an older or equal updatedAt is not an edit", () => {
  const before = { ...summary(1), updatedAt: new Date(5_000) };
  const after = { ...before, updatedAt: new Date(1_000) };
  expect(changesBetween(glanceOf(before, noPrs), glanceOf(after, noPrs))).toEqual([]);
});

test("a different merge status is a pull request change when both sides are known", () => {
  const story = linked(1);
  expect(
    changesBetween(
      glanceOf(story, prs([[1, showing("checks-running")]])),
      glanceOf(linked(1, new Date(5_000)), prs([[1, showing("ready")]])),
    ),
  ).toEqual([{ kind: "pullRequests", from: "checks-running", to: "ready" }]);
});

test("linking a first pull request changes the merge status from none", () => {
  expect(
    changesBetween(glanceOf(summary(1), noPrs), glanceOf(linked(1), prs([[1, showing("draft")]]))),
  ).toEqual([{ kind: "pullRequests", from: "none", to: "draft" }]);
});

test("a merge status still loading, failed, or unknown to GitHub is not a change", () => {
  const story = linked(1);
  const seen = glanceOf(story, prs([[1, showing("ready")]]));
  const unknowable = [
    prs([], checking),
    prs([[1, { status: "failed", message: "gh auth login" }]]),
    prs([[1, showing("ready", "unknown")]]),
  ];
  for (const now of unknowable) {
    expect(changesBetween(seen, glanceOf(story, now))).toEqual([]);
    expect(
      changesBetween(glanceOf(story, now), glanceOf(story, prs([[1, showing("merged")]]))),
    ).toEqual([]);
  }
});

test("state and merge status changes are listed together and explain the later updatedAt", () => {
  const before = linked(1);
  const after = inState(before, finished, new Date(5_000));
  expect(
    changesBetween(
      glanceOf(before, prs([[1, showing("ready")]])),
      glanceOf(after, prs([[1, showing("merged")]])),
    ),
  ).toEqual([
    { kind: "state", from: before.state, to: after.state },
    { kind: "pullRequests", from: "ready", to: "merged" },
  ]);
});
