import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { PullRequestView, Remote, StoryPullRequests } from "../app/model.ts";
import type { PullRequestState } from "../github/types.ts";
import type { PullRequestId, StoryId } from "../shortcut/types.ts";
import { loaded, requestId, storyId, summary } from "./frame.tsx";
import { pullRequestToOpen } from "./pull-requests.ts";

const view = (number: number, state: PullRequestState): PullRequestView => ({
  id: z.custom<PullRequestId>().parse(number),
  title: `PR ${String(number)}`,
  url: `https://github.com/acme/app/pull/${String(number)}`,
  closed: false,
  draft: false,
  github: { owner: "acme", repo: "app", number },
  state,
});

const story = (pullRequestCount: number) => summary(1, { pullRequestCount });

const withPrs = (...prs: PullRequestView[]): Remote<StoryPullRequests> =>
  loaded(new Map<StoryId, PullRequestView[]>([[storyId(1), prs]]));

const cases: [string, ReturnType<typeof story>, Remote<StoryPullRequests>, number | null][] = [
  ["a story without pull requests", story(0), withPrs(), null],
  ["status still loading", story(1), { status: "loading", requestId: requestId(3) }, null],
  ["status failed to load", story(1), { status: "failed", message: "no gh" }, null],
  ["linked but absent from the loaded status", story(1), loaded(new Map()), null],
  ["a single open pull request", story(1), withPrs(view(10, "ready")), 10],
  [
    "the least ready open pull request, not the newest",
    story(3),
    withPrs(view(12, "ready"), view(11, "conflicts"), view(13, "needs-review")),
    11,
  ],
  [
    "an open pull request over a newer merged one",
    story(2),
    withPrs(view(20, "merged"), view(15, "checks-running")),
    15,
  ],
  [
    "the newest of equally unready open pull requests",
    story(2),
    withPrs(view(30, "draft"), view(31, "draft")),
    31,
  ],
  [
    "the newest merged pull request when none is open",
    story(3),
    withPrs(view(40, "merged"), view(42, "merged"), view(41, "closed")),
    42,
  ],
  [
    "the merged pull request over a newer closed one, matching the badge",
    story(2),
    withPrs(view(50, "merged"), view(51, "closed")),
    50,
  ],
  [
    "the newest closed pull request when all are closed",
    story(2),
    withPrs(view(60, "closed"), view(61, "closed")),
    61,
  ],
];

describe("pullRequestToOpen", () => {
  test.each(cases)("%s", (_name, forStory, status, expected) => {
    expect(pullRequestToOpen(forStory, status)?.github?.number ?? null).toBe(expected);
  });
});
