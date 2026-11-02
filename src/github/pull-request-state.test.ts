import { describe, expect, test } from "bun:test";
import { classify, RawPullRequestSchema, storyMergeStatus } from "./pull-request-state.ts";
import type { PullRequestState } from "./types.ts";

const open = {
  state: "OPEN",
  merged: false,
  isDraft: false,
  reviewDecision: null,
  mergeable: "MERGEABLE",
  mergeStateStatus: "UNKNOWN",
  statusCheckRollup: null,
};

const rollup = (state: string) => ({ statusCheckRollup: { state } });

const cases: readonly [string, Record<string, unknown>, PullRequestState][] = [
  ["merged, whatever else it reports", { state: "MERGED", merged: true, isDraft: true }, "merged"],
  ["closed without merging", { state: "CLOSED", isDraft: true }, "closed"],
  ["a draft, even with conflicts", { isDraft: true, mergeable: "CONFLICTING" }, "draft"],
  [
    "conflicting with green checks (live #3917)",
    { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", ...rollup("SUCCESS") },
    "conflicts",
  ],
  ["dirty while mergeability is still computing", { mergeStateStatus: "DIRTY" }, "conflicts"],
  [
    "conflicting with failing checks",
    { mergeable: "CONFLICTING", ...rollup("FAILURE") },
    "conflicts",
  ],
  [
    "failing checks with changes requested",
    { reviewDecision: "CHANGES_REQUESTED", ...rollup("FAILURE") },
    "checks-failing",
  ],
  ["errored checks", { mergeStateStatus: "UNSTABLE", ...rollup("ERROR") }, "checks-failing"],
  [
    "changes requested with checks still running",
    { reviewDecision: "CHANGES_REQUESTED", ...rollup("PENDING") },
    "changes-requested",
  ],
  ["clean", { reviewDecision: "APPROVED", mergeStateStatus: "CLEAN" }, "ready"],
  [
    "clean with optional checks running",
    { mergeStateStatus: "CLEAN", ...rollup("PENDING") },
    "ready",
  ],
  ["mergeable with hooks", { mergeStateStatus: "HAS_HOOKS" }, "ready"],
  [
    "mergeability unknown with checks pending (live #3939)",
    { mergeable: "UNKNOWN", ...rollup("PENDING") },
    "checks-running",
  ],
  [
    "review required while checks are expected",
    { reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED", ...rollup("EXPECTED") },
    "checks-running",
  ],
  [
    "review required with green checks",
    { reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED", ...rollup("SUCCESS") },
    "needs-review",
  ],
  ["blocked with no review decision", { mergeStateStatus: "BLOCKED" }, "needs-review"],
  [
    "approved and green but behind its base",
    { reviewDecision: "APPROVED", mergeStateStatus: "BEHIND", ...rollup("SUCCESS") },
    "unknown",
  ],
  ["nothing known yet", {}, "unknown"],
  [
    "a merge state GitHub added after this was written",
    { mergeStateStatus: "QUEUED", reviewDecision: "SOMETHING_NEW", ...rollup("SKIPPED") },
    "unknown",
  ],
];

describe("classify", () => {
  for (const [name, fields, expected] of cases) {
    test(`${name} is ${expected}`, () => {
      expect(classify(RawPullRequestSchema.parse({ ...open, ...fields }))).toBe(expected);
    });
  }
});

describe("storyMergeStatus", () => {
  test("a story without pull requests has none", () => {
    expect(storyMergeStatus([])).toBe("none");
  });

  test("once nothing is open, any merged pull request makes the story merged", () => {
    expect(storyMergeStatus(["closed", "merged", "closed"])).toBe("merged");
    expect(storyMergeStatus(["merged"])).toBe("merged");
  });

  test("closed pull requests with none merged leave the story closed", () => {
    expect(storyMergeStatus(["closed", "closed"])).toBe("closed");
  });

  test("an open pull request outranks merged and closed ones", () => {
    expect(storyMergeStatus(["merged", "ready", "closed"])).toBe("ready");
  });

  test("the least ready open pull request decides the story", () => {
    const leastReadyFirst: PullRequestState[] = [
      "conflicts",
      "checks-failing",
      "changes-requested",
      "draft",
      "needs-review",
      "checks-running",
      "unknown",
      "ready",
    ];
    leastReadyFirst.forEach((expected, index) => {
      const remaining = leastReadyFirst.slice(index);
      expect(storyMergeStatus(remaining.toReversed())).toBe(expected);
      expect(storyMergeStatus(["merged", ...remaining, "closed"])).toBe(expected);
    });
  });
});
