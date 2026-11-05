import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { storyMergeStatus } from "../github/pull-request-state.ts";
import {
  pullRequestKey,
  type GitHubClient,
  type PullRequestRef,
  type PullRequestState,
  type Reviews,
} from "../github/types.ts";
import type {
  LinkedPullRequest,
  PullRequestId,
  ShortcutClient,
  StoryId,
  StorySummary,
  WorkflowStateId,
} from "../shortcut/types.ts";
import { runEffect, type Clients } from "./effects.ts";
import { summary } from "./fixtures.ts";
import type { RequestId } from "./model.ts";

const requestId = z.custom<RequestId>().parse(7);
const storyId = z.custom<StoryId>().parse(42);
const noon = () => new Date("2026-11-02T12:00:00Z");

const unusedGitHub: GitHubClient = {
  pullRequests: () => Promise.reject(new Error("GitHub should not be asked")),
};

const failing = (shortcut: ShortcutClient): Clients => ({ shortcut, github: unusedGitHub });

const failingClient: ShortcutClient = {
  loadWorkspace: () => Promise.reject(new Error("offline")),
  searchStories: () => Promise.reject(new Error("HTTP 500")),
  getStory: () => Promise.reject(new Error("not found")),
  listPullRequests: () => Promise.reject(new Error("HTTP 502")),
  moveStory: () => Promise.reject(new Error("HTTP 403")),
};

test("a failing workspace load becomes a workspaceFailed message", async () => {
  expect(
    await runEffect(failing(failingClient), { type: "loadWorkspace", requestId }, noon),
  ).toEqual({
    type: "workspaceFailed",
    requestId,
    message: "offline",
  });
});

test("a failing search becomes a searchFailed message", async () => {
  expect(
    await runEffect(
      failing(failingClient),
      { type: "searchStories", requestId, queries: ["x"] },
      noon,
    ),
  ).toEqual({
    type: "searchFailed",
    requestId,
    message: "HTTP 500",
  });
});

test("a failing story fetch carries the story id", async () => {
  expect(
    await runEffect(failing(failingClient), { type: "getStory", requestId, storyId }, noon),
  ).toEqual({
    type: "detailFailed",
    requestId,
    storyId,
    message: "not found",
  });
});

test("a successful search records when its answer arrived, not when it was sent", async () => {
  let clock = new Date("2026-11-02T12:00:00Z");
  const client: ShortcutClient = {
    ...failingClient,
    searchStories: async () => {
      clock = new Date("2026-11-02T12:00:03Z");
      return [];
    },
  };
  const msg = await runEffect(
    failing(client),
    { type: "searchStories", requestId, queries: ["x"] },
    () => clock,
  );
  expect(msg).toEqual({
    type: "searchSucceeded",
    requestId,
    stories: [],
    loadedAt: new Date("2026-11-02T12:00:03Z"),
  });
});

test("a non-Error rejection still produces a failure message", async () => {
  const client: ShortcutClient = {
    ...failingClient,
    searchStories: () => Promise.reject(new Error("x", { cause: "y" }).cause),
  };
  const msg = await runEffect(
    failing(client),
    { type: "searchStories", requestId, queries: ["x"] },
    noon,
  );
  expect(msg).toEqual({ type: "searchFailed", requestId, message: "y" });
});

const searchWith = (answers: Record<string, readonly StorySummary[] | Error>) => {
  const asked: string[] = [];
  const client: ShortcutClient = {
    ...failingClient,
    searchStories: async (query) => {
      asked.push(query);
      const answer = answers[query];
      if (answer === undefined || answer instanceof Error) throw answer ?? new Error(query);
      return answer;
    },
  };
  const run = (queries: readonly string[]) =>
    runEffect(failing(client), { type: "searchStories", requestId, queries }, noon);
  return { asked, run };
};

describe("a search with several queries", () => {
  test("answers every query's stories once, even when two queries find the same story", async () => {
    const { asked, run } = searchWith({
      "state:1": [summary(1), summary(2)],
      "state:2": [summary(2), summary(3)],
    });
    const msg = await run(["state:1", "state:2"]);
    expect(asked.toSorted()).toEqual(["state:1", "state:2"]);
    expect(msg.type === "searchSucceeded" ? msg.stories.map((story) => story.id) : msg).toEqual([
      summary(1).id,
      summary(2).id,
      summary(3).id,
    ]);
  });

  test("fails with the failing query's message when any query fails", async () => {
    const { run } = searchWith({ "state:1": [summary(1)], "state:2": new Error("HTTP 429") });
    expect(await run(["state:1", "state:2"])).toEqual({
      type: "searchFailed",
      requestId,
      message: "HTTP 429",
    });
  });

  test("answers no stories without asking Shortcut when there are no queries", async () => {
    const { asked, run } = searchWith({});
    expect(await run([])).toEqual({
      type: "searchSucceeded",
      requestId,
      stories: [],
      loadedAt: noon(),
    });
    expect(asked).toEqual([]);
  });
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

const noReviews: Reviews = { requested: [], submitted: [] };
const askingYou: Reviews = {
  requested: [{ kind: "team", slug: "engineering", reachesYou: "yes" }],
  submitted: [],
};

test("loading pull requests asks GitHub once for every story's pull requests", async () => {
  const asked: (readonly PullRequestRef[])[] = [];
  const github: GitHubClient = {
    pullRequests: async (refs) => {
      asked.push(refs);
      return new Map([
        [
          pullRequestKey(monorepo(3917)),
          { state: "conflicts", reviews: askingYou, optionalFailing: ["pr-preview"] },
        ],
        [
          pullRequestKey(monorepo(3911)),
          { state: "ready", reviews: noReviews, optionalFailing: [] },
        ],
      ]);
    },
  };
  const msg = await runEffect(
    { shortcut: linkingShortcut, github },
    { type: "loadPullRequests", requestId, storyIds: [storyId, otherStoryId] },
    noon,
  );
  expect(asked.length).toBe(1);
  expect(msg).toEqual({
    type: "pullRequestsLoaded",
    requestId,
    pullRequests: new Map([
      [
        storyId,
        {
          status: "loaded",
          value: [
            { ...toggle, state: "conflicts", reviews: askingYou, optionalFailing: ["pr-preview"] },
            { ...gitlab, state: "unknown", reviews: null, optionalFailing: [] },
          ],
        },
      ],
      [
        otherStoryId,
        {
          status: "loaded",
          value: [
            { ...docs, state: "ready", reviews: noReviews, optionalFailing: [] },
            { ...toggle, state: "conflicts", reviews: askingYou, optionalFailing: ["pr-preview"] },
          ],
        },
      ],
    ]),
  });
});

test("a GitHub failure fails the whole pull request load with GitHub's message", async () => {
  const github: GitHubClient = {
    pullRequests: () => Promise.reject(new Error("GitHub status needs the gh CLI")),
  };
  const msg = await runEffect(
    { shortcut: linkingShortcut, github },
    { type: "loadPullRequests", requestId, storyIds: [storyId] },
    noon,
  );
  expect(msg).toEqual({
    type: "pullRequestsFailed",
    requestId,
    message: "GitHub status needs the gh CLI",
  });
});

test("a failing move becomes a moveFailed message for its story", async () => {
  const stateId = z.custom<WorkflowStateId>().parse(3);
  expect(
    await runEffect(
      failing(failingClient),
      { type: "moveStory", requestId, storyId, stateId },
      noon,
    ),
  ).toEqual({ type: "moveFailed", requestId, storyId, message: "HTTP 403" });
});

const answeredBy = (answers: [PullRequestRef, PullRequestState][]): GitHubClient => ({
  pullRequests: async () =>
    new Map(
      answers.map(([ref, state]) => [
        pullRequestKey(ref),
        { state, reviews: noReviews, optionalFailing: [] },
      ]),
    ),
});

const loadedStates = async (github: GitHubClient, links: readonly LinkedPullRequest[]) => {
  const shortcut: ShortcutClient = { ...failingClient, listPullRequests: async () => links };
  const msg = await runEffect(
    { shortcut, github },
    { type: "loadPullRequests", requestId, storyIds: [storyId] },
    noon,
  );
  if (msg.type !== "pullRequestsLoaded") throw new Error(`expected a load, got ${msg.type}`);
  const list = msg.pullRequests.get(storyId);
  if (list?.status !== "loaded") throw new Error("expected the story's list to load");
  return list.value.map((pr) => pr.state);
};

const gitlabMr = (shortcutSays: { closed?: boolean; draft?: boolean }) => ({
  ...gitlab,
  ...shortcutSays,
});
const unanswered = (shortcutSays: { closed?: boolean; draft?: boolean }) => ({
  ...toggle,
  ...shortcutSays,
});

const fallbackCases: [string, LinkedPullRequest, PullRequestState][] = [
  ["a non-GitHub link Shortcut says is closed", gitlabMr({ closed: true }), "closed"],
  ["a non-GitHub link Shortcut says is a draft", gitlabMr({ draft: true }), "draft"],
  ["a closed draft on a non-GitHub host", gitlabMr({ closed: true, draft: true }), "closed"],
  ["an open non-GitHub link", gitlabMr({}), "unknown"],
  [
    "a GitHub link GitHub left unanswered, closed in Shortcut",
    unanswered({ closed: true }),
    "closed",
  ],
  [
    "a GitHub link GitHub left unanswered, a draft in Shortcut",
    unanswered({ draft: true }),
    "draft",
  ],
  ["a GitHub link GitHub left unanswered, open in Shortcut", unanswered({}), "unknown"],
];

describe("a pull request GitHub did not answer falls back to what Shortcut knows", () => {
  test.each(fallbackCases)("%s", async (_name, link, expected) => {
    expect(await loadedStates(answeredBy([]), [link])).toEqual([expected]);
  });
});

test("GitHub's answer outranks Shortcut's flags for a pull request it answered", async () => {
  const states = await loadedStates(answeredBy([[monorepo(3917), "merged"]]), [
    unanswered({ closed: true }),
  ]);
  expect(states).toEqual(["merged"]);
});

test("a merged GitHub pull request plus a closed GitLab merge request makes the story merged", async () => {
  const states = await loadedStates(answeredBy([[monorepo(3917), "merged"]]), [
    toggle,
    gitlabMr({ closed: true }),
  ]);
  expect(storyMergeStatus(states)).toBe("merged");
});

test("a merged GitHub pull request plus an open GitLab merge request leaves the story open", async () => {
  const states = await loadedStates(answeredBy([[monorepo(3917), "merged"]]), [toggle, gitlab]);
  expect(storyMergeStatus(states)).toBe("unknown");
});

const manyStories = (count: number) =>
  Array.from({ length: count }, (_, i) => z.custom<StoryId>().parse(i + 1));

const silentGitHub: GitHubClient = { pullRequests: async () => new Map() };

test("loading pull requests for 500 stories keeps at most 6 Shortcut requests in flight", async () => {
  const inFlight = { now: 0, max: 0, calls: 0 };
  const shortcut: ShortcutClient = {
    ...failingClient,
    listPullRequests: async () => {
      inFlight.calls += 1;
      inFlight.now += 1;
      inFlight.max = Math.max(inFlight.max, inFlight.now);
      await Bun.sleep(1);
      inFlight.now -= 1;
      return [];
    },
  };
  const msg = await runEffect(
    { shortcut, github: silentGitHub },
    { type: "loadPullRequests", requestId, storyIds: manyStories(500) },
    noon,
  );
  expect(msg.type).toBe("pullRequestsLoaded");
  expect(inFlight.calls).toBe(500);
  expect(inFlight.max).toBe(6);
});

test("a story whose pull request list fails is marked failed while the rest still load", async () => {
  const shortcut: ShortcutClient = {
    ...failingClient,
    listPullRequests: async (id) => {
      if (id === 7)
        throw new Error("Shortcut API 429 for GET /api/v4/acme/stories/7/pull-requests");
      return id === 8 ? [gitlab] : [];
    },
  };
  const msg = await runEffect(
    { shortcut, github: silentGitHub },
    { type: "loadPullRequests", requestId, storyIds: manyStories(20) },
    noon,
  );
  if (msg.type !== "pullRequestsLoaded") throw new Error(`expected a load, got ${msg.type}`);
  expect(msg.pullRequests.size).toBe(20);
  expect(msg.pullRequests.get(z.custom<StoryId>().parse(7))).toEqual({
    status: "failed",
    message: "Shortcut API 429 for GET /api/v4/acme/stories/7/pull-requests",
  });
  expect(msg.pullRequests.get(z.custom<StoryId>().parse(8))).toEqual({
    status: "loaded",
    value: [{ ...gitlab, state: "unknown", reviews: null, optionalFailing: [] }],
  });
});

test("the load fails with the first error only when every story's list fails", async () => {
  const shortcut: ShortcutClient = {
    ...failingClient,
    listPullRequests: async (id) => {
      throw new Error(`Shortcut API 429 for story ${String(id)}`);
    },
  };
  expect(
    await runEffect(
      { shortcut, github: unusedGitHub },
      { type: "loadPullRequests", requestId, storyIds: manyStories(3) },
      noon,
    ),
  ).toEqual({ type: "pullRequestsFailed", requestId, message: "Shortcut API 429 for story 1" });
});
