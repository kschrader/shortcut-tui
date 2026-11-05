import { describe, expect, test } from "bun:test";
import type { Check } from "./checks.ts";
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
    "mergeable while optional checks still run",
    { mergeStateStatus: "UNSTABLE", ...rollup("PENDING") },
    "ready",
  ],
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
  [
    "review required while mergeability is computing",
    { reviewDecision: "REVIEW_REQUIRED" },
    "needs-review",
  ],
  ["blocked with no review decision", { mergeStateStatus: "BLOCKED" }, "blocked"],
  [
    "approved and green but blocked by branch rules",
    { reviewDecision: "APPROVED", mergeStateStatus: "BLOCKED", ...rollup("SUCCESS") },
    "blocked",
  ],
  [
    "approved and blocked while required checks run",
    { reviewDecision: "APPROVED", mergeStateStatus: "BLOCKED", ...rollup("PENDING") },
    "checks-running",
  ],
  [
    "approved and green but behind its base",
    { reviewDecision: "APPROVED", mergeStateStatus: "BEHIND", ...rollup("SUCCESS") },
    "behind",
  ],
  [
    "behind its base while review is required",
    { reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BEHIND" },
    "behind",
  ],
  [
    "behind its base with failing checks",
    { mergeStateStatus: "BEHIND", ...rollup("FAILURE") },
    "checks-failing",
  ],
  [
    "the deprecated DRAFT merge state on a draft",
    { isDraft: true, mergeStateStatus: "DRAFT" },
    "draft",
  ],
  ["nothing known yet", {}, "unknown"],
  [
    "a merge state GitHub added after this was written",
    { mergeStateStatus: "QUEUED", reviewDecision: "SOMETHING_NEW", ...rollup("SKIPPED") },
    "unknown",
  ],
];

describe("classify from the rollup alone", () => {
  for (const [name, fields, expected] of cases) {
    test(`${name} is ${expected}`, () => {
      expect(classify(RawPullRequestSchema.parse({ ...open, ...fields }), null)).toBe(expected);
    });
  }
});

const required = (name: string, outcome: Check["outcome"]): Check => ({
  name,
  required: true,
  outcome,
});
const optional = (name: string, outcome: Check["outcome"]): Check => ({
  name,
  required: false,
  outcome,
});

const requiredPassing = ["type-check", "lint", "vitest", "betterer", "unit-tests"].map((name) =>
  required(name, "passed"),
);

const live4044 = { mergeStateStatus: "BLOCKED", reviewDecision: null, ...rollup("FAILURE") };

const checkCases: readonly [string, Record<string, unknown>, readonly Check[], PullRequestState][] =
  [
    [
      "an optional failure and the review gate waiting, required checks green (live #4044)",
      live4044,
      [...requiredPassing, optional("pr-preview", "failed"), required("review-gate", "running")],
      "needs-review",
    ],
    [
      "the review gate waiting while not required",
      live4044,
      [...requiredPassing, optional("review-gate", "running")],
      "needs-review",
    ],
    [
      "a required failure while the review gate waits",
      live4044,
      [required("vitest", "failed"), required("review-gate", "running")],
      "checks-failing",
    ],
    [
      "a required status context that errored",
      { mergeStateStatus: "BLOCKED", ...rollup("ERROR") },
      [required("ci/circleci", "failed")],
      "checks-failing",
    ],
    [
      "a required check still running",
      { mergeStateStatus: "BLOCKED", ...rollup("PENDING") },
      [required("vitest", "running"), optional("pr-preview", "running")],
      "checks-running",
    ],
    [
      "only optional checks pending",
      { mergeStateStatus: "BLOCKED", ...rollup("PENDING") },
      [...requiredPassing, optional("pr-preview", "running")],
      "blocked",
    ],
    [
      "only optional checks failing with review required",
      { reviewDecision: "REVIEW_REQUIRED", mergeStateStatus: "BLOCKED", ...rollup("FAILURE") },
      [...requiredPassing, optional("pr-preview", "failed")],
      "needs-review",
    ],
    [
      "the review gate passed but branch rules still block",
      { mergeStateStatus: "BLOCKED", ...rollup("FAILURE") },
      [required("review-gate", "passed"), optional("pr-preview", "failed")],
      "blocked",
    ],
    [
      "mergeable with only optional checks failing (live #3033)",
      { mergeStateStatus: "UNSTABLE", ...rollup("FAILURE") },
      [...requiredPassing, optional("pr-preview", "failed")],
      "ready",
    ],
    [
      "conflicts with a required failure",
      { mergeable: "CONFLICTING", ...rollup("FAILURE") },
      [required("vitest", "failed")],
      "conflicts",
    ],
    [
      "conflicts with the review gate waiting",
      { mergeStateStatus: "DIRTY", ...rollup("PENDING") },
      [required("review-gate", "running")],
      "conflicts",
    ],
    [
      "changes requested while the review gate waits",
      { reviewDecision: "CHANGES_REQUESTED", mergeStateStatus: "BLOCKED", ...rollup("PENDING") },
      [required("review-gate", "running")],
      "changes-requested",
    ],
  ];

describe("classify from the checks GitHub listed", () => {
  for (const [name, fields, checks, expected] of checkCases) {
    test(`${name} is ${expected}`, () => {
      expect(classify(RawPullRequestSchema.parse({ ...open, ...fields }), checks)).toBe(expected);
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
      "behind",
      "draft",
      "needs-review",
      "blocked",
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
