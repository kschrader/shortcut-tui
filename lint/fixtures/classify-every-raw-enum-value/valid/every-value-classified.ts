import { z } from "zod";

type PullRequestState =
  | "merged"
  | "conflicts"
  | "checks-failing"
  | "behind"
  | "ready"
  | "needs-review"
  | "blocked";

export const RawPullRequestSchema = z.object({
  state: z.enum(["OPEN", "MERGED"]),
  reviewDecision: z.enum(["APPROVED", "REVIEW_REQUIRED"]).nullable().catch(null),
  mergeable: z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]).catch("UNKNOWN"),
  mergeStateStatus: z.enum(["BEHIND", "BLOCKED", "CLEAN", "UNKNOWN", "UNSTABLE"]).catch("UNKNOWN"),
  statusCheckRollup: z
    .object({ state: z.enum(["FAILURE", "SUCCESS"]).nullable() })
    .nullable()
    .catch(null)
    .transform((rollup) => rollup?.state ?? null),
});

type RawPullRequest = z.infer<typeof RawPullRequestSchema>;

export const DECIDED_BY_OTHER_FIELDS = {
  reviewDecision: ["APPROVED"],
  mergeable: ["MERGEABLE"],
  mergeStateStatus: ["UNSTABLE"],
  statusCheckRollup: ["SUCCESS"],
} as const;

const CLASSIFICATION: readonly (readonly [PullRequestState, (pr: RawPullRequest) => boolean])[] = [
  ["merged", (pr) => pr.state === "MERGED"],
  ["conflicts", (pr) => pr.mergeable === "CONFLICTING"],
  ["checks-failing", (pr) => pr.statusCheckRollup === "FAILURE"],
  ["behind", (pr) => pr.mergeStateStatus === "BEHIND"],
  ["ready", (pr) => pr.mergeStateStatus === "CLEAN"],
  ["needs-review", (pr) => pr.reviewDecision === "REVIEW_REQUIRED"],
  ["blocked", (pr) => pr.mergeStateStatus === "BLOCKED"],
];

export const awaitsMergeability = (pr: RawPullRequest): boolean =>
  pr.state === "OPEN" && (pr.mergeable === "UNKNOWN" || pr.mergeStateStatus === "UNKNOWN");

export const classify = (pr: RawPullRequest): PullRequestState | "unknown" =>
  CLASSIFICATION.find(([, holds]) => holds(pr))?.[0] ?? "unknown";
