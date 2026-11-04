import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import type { Cached, PullRequestView, Question, StoryPullRequests } from "../app/model.ts";
import { queryQuestion, withoutFloor } from "../app/filters.ts";
import { orderFor } from "../app/order.ts";
import type { PullRequestState, Reviews } from "../github/types.ts";
import type { PullRequestId, StorySummary } from "../shortcut/types.ts";
import {
  cached,
  cleanup,
  grace,
  inProgress,
  loaded,
  modelWith,
  reloading,
  requestId,
  settled,
  show,
  storyId,
  summary,
} from "./frame.tsx";

afterEach(cleanup);

const now = new Date("2026-11-02T09:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const inReview = { ...inProgress, name: "In Review" };

const waiting = (id: number, name: string, movedAt: Date): StorySummary =>
  summary(id, { name, owners: [grace], state: inReview, movedAt, pullRequestCount: 1 });

const reviewStories = [
  waiting(301, "Paginate the iteration list", ago(3 * DAY)),
  waiting(302, "Fix flaky label sync test", ago(15 * DAY)),
  waiting(303, "Retry webhook deliveries with backoff and jitter", ago(20 * 60_000)),
].toSorted(orderFor("owner"));

const view = (
  number: number,
  state: PullRequestState,
  reviews: Reviews | null,
): PullRequestView => ({
  id: z.custom<PullRequestId>().parse(number),
  title: `Pull request ${String(number)}`,
  url: `https://github.com/useshortcut/monorepo/pull/${String(number)}`,
  closed: false,
  draft: false,
  github: { owner: "useshortcut", repo: "monorepo", number },
  state,
  reviews,
});

const forYou: Reviews = {
  requested: [
    { kind: "team", slug: "engineering", reachesYou: "yes" },
    { kind: "user", login: "andreas", reachesYou: "no" },
  ],
  submitted: [],
};

const reviewed: Reviews = {
  requested: [],
  submitted: [
    { login: "priya", verdict: "approved" },
    { login: "sam", verdict: "changes-requested" },
  ],
};

const answered: StoryPullRequests = new Map([
  [storyId(301), settled<readonly PullRequestView[]>([view(3970, "needs-review", forYou)])],
  [
    storyId(302),
    settled<readonly PullRequestView[]>([
      view(3971, "checks-running", reviewed),
      view(3972, "draft", { requested: [], submitted: [] }),
    ]),
  ],
  [storyId(303), settled<readonly PullRequestView[]>([view(3973, "merged", forYou)])],
]);

const reviewView: Question = withoutFloor({ kind: "inReview" });

const showing = (
  question: Question,
  pullRequests: Cached<StoryPullRequests> = cached(answered),
  width = 80,
) =>
  show(
    modelWith({
      question,
      results: loaded({ question, stories: reviewStories }),
      selectedStoryId: storyId(301),
      details: new Map(),
      pullRequests,
    }),
    { width, now },
  );

const listRows = (frame: string) =>
  frame
    .split("\n")
    .map((line) => line.split("│")[0] ?? "")
    .filter((line) => /\s30\d\s/.test(line));

test("the review view at 80 columns shows how long each story has waited, and marks only an open pull request asking for your review", async () => {
  const { frame } = await showing(reviewView);
  const rows = listRows(frame());
  expect(rows).toHaveLength(3);
  expect(rows[0]).toMatch(/^ {2}●\s+302 Fix flaky label sync test\s+2w ◌ +3 $/);
  expect(rows[1]).toMatch(/^▌@●\s+301 Paginate the iteration list\s+3d ○ +3 $/);
  expect(rows[2]).toMatch(/^ {2}●\s+303 Retry webhook deliveries with\S* … <1h ◉ +3 $/);
  expect(new Set(rows.map((row) => row.length)).size).toBe(1);
  expect(frame().split("\n")[0]).toMatch(/3 stories {2}· {2}1 for you $/);
});

test("no story is marked while its pull requests are still being checked", async () => {
  const { frame } = await showing(reviewView, cached(new Map(), reloading(requestId(4))));
  expect(listRows(frame()).some((row) => row.includes("@"))).toBe(false);
  expect(frame().split("\n")[0]).not.toContain("for you");
  expect(listRows(frame())[1]).toContain(" 3d ");
});

test("my stories show neither how long they waited nor the review mark", async () => {
  const { frame } = await showing(queryQuestion("owner:me"));
  const rows = listRows(frame());
  expect(rows).toHaveLength(3);
  expect(rows.some((row) => /@|\b3d\b|\b2w\b|<1h/.test(row))).toBe(false);
  expect(frame().split("\n")[0]).not.toContain("for you");
});

test("the detail pane says how long the story has been in its state and who each pull request asks for review", async () => {
  const { frame } = await showing(reviewView, cached(answered), 160);
  expect(frame()).toContain("State     In Review for 3 days");
  expect(frame()).toContain("review requested from you (via engineering), @andreas");
});

test("the detail pane lists submitted reviews, and says when nobody was asked", async () => {
  const { frame } = await show(
    modelWith({
      question: reviewView,
      results: loaded({ question: reviewView, stories: reviewStories }),
      selectedStoryId: storyId(302),
      details: new Map(),
      pullRequests: cached(answered),
    }),
    { width: 160, now },
  );
  expect(frame()).toContain("State     In Review for 2 weeks");
  expect(frame()).toContain("approved by @priya · changes requested by @sam");
  expect(frame()).toContain("no review requested");
});
