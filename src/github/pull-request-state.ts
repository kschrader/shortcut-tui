import { z } from "zod";
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
    .enum(["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNKNOWN", "UNSTABLE"])
    .catch("UNKNOWN"),
  statusCheckRollup: z
    .object({ state: z.enum(["ERROR", "EXPECTED", "FAILURE", "PENDING", "SUCCESS"]).nullable() })
    .nullable()
    .catch(null),
});

export type RawPullRequest = z.infer<typeof RawPullRequestSchema>;

const checks = (pr: RawPullRequest) => pr.statusCheckRollup?.state ?? null;

const CLASSIFICATION: readonly (readonly [PullRequestState, (pr: RawPullRequest) => boolean])[] = [
  ["merged", (pr) => pr.merged || pr.state === "MERGED"],
  ["closed", (pr) => pr.state === "CLOSED"],
  ["draft", (pr) => pr.isDraft],
  ["conflicts", (pr) => pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY"],
  ["checks-failing", (pr) => checks(pr) === "FAILURE" || checks(pr) === "ERROR"],
  ["changes-requested", (pr) => pr.reviewDecision === "CHANGES_REQUESTED"],
  ["ready", (pr) => pr.mergeStateStatus === "CLEAN" || pr.mergeStateStatus === "HAS_HOOKS"],
  ["checks-running", (pr) => checks(pr) === "PENDING" || checks(pr) === "EXPECTED"],
  [
    "needs-review",
    (pr) => pr.reviewDecision === "REVIEW_REQUIRED" || pr.mergeStateStatus === "BLOCKED",
  ],
];

export const awaitsMergeability = (pr: RawPullRequest): boolean =>
  pr.state === "OPEN" && !pr.isDraft && pr.mergeable === "UNKNOWN";

export const classify = (pr: RawPullRequest): PullRequestState =>
  CLASSIFICATION.find(([, holds]) => holds(pr))?.[0] ?? "unknown";

export type StoryMergeStatus = "none" | PullRequestState;

type OpenState = Exclude<PullRequestState, "merged" | "closed">;

const isOpen = (state: PullRequestState): state is OpenState =>
  state !== "merged" && state !== "closed";

const LEAST_READY_FIRST: Record<OpenState, number> = {
  conflicts: 0,
  "checks-failing": 1,
  "changes-requested": 2,
  draft: 3,
  "needs-review": 4,
  "checks-running": 5,
  unknown: 6,
  ready: 7,
};

export const storyMergeStatus = (states: readonly PullRequestState[]): StoryMergeStatus => {
  const [leastReady] = states
    .filter(isOpen)
    .toSorted((a, b) => LEAST_READY_FIRST[a] - LEAST_READY_FIRST[b]);
  if (leastReady !== undefined) return leastReady;
  if (states.length === 0) return "none";
  return states.includes("merged") ? "merged" : "closed";
};
