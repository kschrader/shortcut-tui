import { z } from "zod";
import { signalsOf, type Check, type CheckSignals } from "./checks.ts";
import { reviewFields } from "./reviews.ts";
import type { PullRequestState } from "./types.ts";

export const RawPullRequestSchema = z.object({
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  merged: z.boolean(),
  isDraft: z.boolean(),
  reviewDecision: z
    .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
    .nullable()
    .catch(null),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]).catch("UNKNOWN"),
  mergeStateStatus: z
    .enum(["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "HAS_HOOKS", "UNKNOWN", "UNSTABLE"])
    .catch("UNKNOWN"),
  statusCheckRollup: z
    .object({ state: z.enum(["ERROR", "EXPECTED", "FAILURE", "PENDING", "SUCCESS"]).nullable() })
    .nullable()
    .catch(null)
    .transform((rollup) => rollup?.state ?? null),
  ...reviewFields,
});

export type RawPullRequest = z.infer<typeof RawPullRequestSchema>;

export const DECIDED_BY_OTHER_FIELDS = {
  reviewDecision: ["APPROVED"],
  mergeable: ["MERGEABLE"],
  statusCheckRollup: ["SUCCESS"],
} as const satisfies {
  [Field in keyof RawPullRequest]?: readonly NonNullable<RawPullRequest[Field]>[];
};

type Facts = Omit<RawPullRequest, "statusCheckRollup"> & { checks: CheckSignals };

const CLASSIFICATION: readonly (readonly [PullRequestState, (pr: Facts) => boolean])[] = [
  ["merged", (pr) => pr.merged || pr.state === "MERGED"],
  ["closed", (pr) => pr.state === "CLOSED"],
  ["draft", (pr) => pr.isDraft],
  ["conflicts", (pr) => pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY"],
  ["checks-failing", (pr) => pr.checks.failing],
  ["changes-requested", (pr) => pr.reviewDecision === "CHANGES_REQUESTED"],
  ["behind", (pr) => pr.mergeStateStatus === "BEHIND"],
  [
    "ready",
    (pr) =>
      pr.mergeStateStatus === "CLEAN" ||
      pr.mergeStateStatus === "HAS_HOOKS" ||
      pr.mergeStateStatus === "UNSTABLE",
  ],
  ["checks-running", (pr) => pr.checks.running],
  ["needs-review", (pr) => pr.reviewDecision === "REVIEW_REQUIRED" || pr.checks.awaitingApproval],
  ["blocked", (pr) => pr.mergeStateStatus === "BLOCKED"],
];

const rollupSignals = (pr: RawPullRequest): CheckSignals => ({
  failing: pr.statusCheckRollup === "FAILURE" || pr.statusCheckRollup === "ERROR",
  running: pr.statusCheckRollup === "PENDING" || pr.statusCheckRollup === "EXPECTED",
  awaitingApproval: false,
});

export const awaitsMergeability = (pr: RawPullRequest): boolean =>
  pr.state === "OPEN" &&
  !pr.isDraft &&
  (pr.mergeable === "UNKNOWN" || pr.mergeStateStatus === "UNKNOWN");

export const classify = (pr: RawPullRequest, checks: readonly Check[] | null): PullRequestState => {
  const facts = { ...pr, checks: checks === null ? rollupSignals(pr) : signalsOf(checks) };
  return CLASSIFICATION.find(([, holds]) => holds(facts))?.[0] ?? "unknown";
};

export const checksCanDecide = (pr: RawPullRequest): boolean => {
  const state = classify(pr, null);
  return state === "checks-failing" || state === "checks-running";
};

export type StoryMergeStatus = "none" | PullRequestState;

type OpenState = Exclude<PullRequestState, "merged" | "closed">;

const isOpen = (state: PullRequestState): state is OpenState =>
  state !== "merged" && state !== "closed";

const LEAST_READY_FIRST: Record<OpenState, number> = {
  conflicts: 0,
  "checks-failing": 1,
  "changes-requested": 2,
  behind: 3,
  draft: 4,
  "needs-review": 5,
  blocked: 6,
  "checks-running": 7,
  unknown: 8,
  ready: 9,
};

export const storyMergeStatus = (states: readonly PullRequestState[]): StoryMergeStatus => {
  const [leastReady] = states
    .filter(isOpen)
    .toSorted((a, b) => LEAST_READY_FIRST[a] - LEAST_READY_FIRST[b]);
  if (leastReady !== undefined) return leastReady;
  if (states.length === 0) return "none";
  return states.includes("merged") ? "merged" : "closed";
};
