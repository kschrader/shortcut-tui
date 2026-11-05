import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { Cached, PullRequestView, StoryPullRequests } from "../app/model.ts";
import type { PullRequestState } from "../github/types.ts";
import type { PullRequestId } from "../shortcut/types.ts";
import { cached, reloading, reloadFailed, requestId, settled, storyId, summary } from "./frame.tsx";
import { pullRequestToOpen, storyBadge } from "./pull-requests.ts";

const view = (number: number, state: PullRequestState): PullRequestView => ({
  id: z.custom<PullRequestId>().parse(number),
  title: `PR ${String(number)}`,
  url: `https://github.com/acme/app/pull/${String(number)}`,
  closed: false,
  draft: false,
  github: { owner: "acme", repo: "app", number },
  state,
  reviews: null,
  optionalFailing: [],
});

const story = (pullRequestCount: number) => summary(1, { pullRequestCount });

const withPrs = (...prs: PullRequestView[]): Cached<StoryPullRequests> =>
  cached(new Map([[storyId(1), settled<readonly PullRequestView[]>(prs)]]));

const cases: [string, ReturnType<typeof story>, Cached<StoryPullRequests>, number | null][] = [
  ["a story without pull requests", story(0), withPrs(), null],
  ["status still loading", story(1), cached(new Map(), reloading(requestId(3))), null],
  ["status failed to load", story(1), cached(new Map(), reloadFailed("no gh")), null],
  ["linked but absent from the loaded status", story(1), cached(new Map()), null],
  [
    "the story's own list failed to load",
    story(1),
    cached(new Map([[storyId(1), { status: "failed", message: "HTTP 429" } as const]])),
    null,
  ],
  [
    "a status kept while a reload is in flight",
    story(1),
    { ...withPrs(view(10, "ready")), reload: reloading(requestId(3)) },
    10,
  ],
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

describe("storyBadge while status reloads", () => {
  const whileReloading = { ...withPrs(view(10, "ready")), reload: reloading(requestId(3)) };

  test("a story with a kept status shows it", () => {
    expect(storyBadge(story(1), whileReloading)).toBe("ready");
  });

  test("a linking story with no status yet shows checking", () => {
    expect(storyBadge(summary(2, { pullRequestCount: 1 }), whileReloading)).toBe("checking");
  });

  test("a story without pull requests shows nothing", () => {
    expect(storyBadge(summary(2), whileReloading)).toBeNull();
  });

  test("after a failed reload a story with no status shows nothing", () => {
    expect(
      storyBadge(summary(2, { pullRequestCount: 1 }), cached(new Map(), reloadFailed("no gh"))),
    ).toBeNull();
  });
});
