import { expect, test } from "bun:test";
import { z } from "zod";
import { pullRequestKey, type GitHubClient, type PullRequestRef } from "../github/types.ts";
import type {
  LinkedPullRequest,
  PullRequestId,
  ShortcutClient,
  StoryId,
} from "../shortcut/types.ts";
import { runEffect, type Clients } from "./effects.ts";
import type { RequestId } from "./model.ts";

const requestId = z.custom<RequestId>().parse(7);
const storyId = z.custom<StoryId>().parse(42);

const unusedGitHub: GitHubClient = {
  pullRequestStates: () => Promise.reject(new Error("GitHub should not be asked")),
};

const failing = (shortcut: ShortcutClient): Clients => ({ shortcut, github: unusedGitHub });

const failingClient: ShortcutClient = {
  loadWorkspace: () => Promise.reject(new Error("offline")),
  searchStories: () => Promise.reject(new Error("HTTP 500")),
  getStory: () => Promise.reject(new Error("not found")),
  listPullRequests: () => Promise.reject(new Error("HTTP 502")),
};

test("a failing workspace load becomes a workspaceFailed message", async () => {
  expect(await runEffect(failing(failingClient), { type: "loadWorkspace", requestId })).toEqual({
    type: "workspaceFailed",
    requestId,
    message: "offline",
  });
});

test("a failing search becomes a searchFailed message", async () => {
  expect(
    await runEffect(failing(failingClient), { type: "searchStories", requestId, query: "x" }),
  ).toEqual({
    type: "searchFailed",
    requestId,
    message: "HTTP 500",
  });
});

test("a failing story fetch carries the story id", async () => {
  expect(await runEffect(failing(failingClient), { type: "getStory", requestId, storyId })).toEqual(
    {
      type: "detailFailed",
      requestId,
      storyId,
      message: "not found",
    },
  );
});

test("a non-Error rejection still produces a failure message", async () => {
  const client: ShortcutClient = {
    ...failingClient,
    searchStories: () => Promise.reject(new Error("x", { cause: "y" }).cause),
  };
  const msg = await runEffect(failing(client), { type: "searchStories", requestId, query: "x" });
  expect(msg).toEqual({ type: "searchFailed", requestId, message: "y" });
});

const otherStoryId = z.custom<StoryId>().parse(43);

const linked = (id: number, url: string, github: PullRequestRef | null): LinkedPullRequest => ({
  id: z.custom<PullRequestId>().parse(id),
  title: `Pull request ${String(id)}`,
  url,
  closed: false,
  draft: false,
  github,
});

const monorepo = (number: number): PullRequestRef => ({
  owner: "useshortcut",
  repo: "monorepo",
  number,
});

const toggle = linked(1, "https://github.com/useshortcut/monorepo/pull/3917", monorepo(3917));
const docs = linked(2, "https://github.com/useshortcut/monorepo/pull/3911", monorepo(3911));
const gitlab = linked(3, "https://gitlab.com/acme/app/-/merge_requests/5", null);

const linkingShortcut: ShortcutClient = {
  ...failingClient,
  listPullRequests: async (id) => (id === storyId ? [toggle, gitlab] : [docs, toggle]),
};

test("loading pull requests asks GitHub once for every story's pull requests", async () => {
  const asked: (readonly PullRequestRef[])[] = [];
  const github: GitHubClient = {
    pullRequestStates: async (refs) => {
      asked.push(refs);
      return new Map([
        [pullRequestKey(monorepo(3917)), "conflicts"],
        [pullRequestKey(monorepo(3911)), "ready"],
      ]);
    },
  };
  const msg = await runEffect(
    { shortcut: linkingShortcut, github },
    { type: "loadPullRequests", requestId, storyIds: [storyId, otherStoryId] },
  );
  expect(asked.length).toBe(1);
  expect(msg).toEqual({
    type: "pullRequestsLoaded",
    requestId,
    pullRequests: new Map([
      [
        storyId,
        [
          { ...toggle, state: "conflicts" },
          { ...gitlab, state: "unknown" },
        ],
      ],
      [
        otherStoryId,
        [
          { ...docs, state: "ready" },
          { ...toggle, state: "conflicts" },
        ],
      ],
    ]),
  });
});

test("a GitHub failure fails the whole pull request load with GitHub's message", async () => {
  const github: GitHubClient = {
    pullRequestStates: () => Promise.reject(new Error("GitHub status needs the gh CLI")),
  };
  const msg = await runEffect(
    { shortcut: linkingShortcut, github },
    { type: "loadPullRequests", requestId, storyIds: [storyId] },
  );
  expect(msg).toEqual({
    type: "pullRequestsFailed",
    requestId,
    message: "GitHub status needs the gh CLI",
  });
});
