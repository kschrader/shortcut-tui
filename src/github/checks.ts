import { z } from "zod";

export type CheckOutcome = "passed" | "failed" | "running" | "skipped";

export type Check = { name: string; required: boolean; outcome: CheckOutcome };

export type CheckSignals = { failing: boolean; running: boolean; awaitingApproval: boolean };

export const APPROVAL_GATES: ReadonlySet<string> = new Set(["review-gate"]);

const OUTCOMES: ReadonlyMap<string, CheckOutcome> = new Map(
  Object.entries({
    REQUESTED: "running",
    QUEUED: "running",
    IN_PROGRESS: "running",
    WAITING: "running",
    PENDING: "running",
    EXPECTED: "running",
    SUCCESS: "passed",
    NEUTRAL: "passed",
    SKIPPED: "skipped",
    FAILURE: "failed",
    ERROR: "failed",
    TIMED_OUT: "failed",
    STARTUP_FAILURE: "failed",
    CANCELLED: "failed",
    ACTION_REQUIRED: "failed",
    STALE: "failed",
  } satisfies Record<string, CheckOutcome>),
);

const checkOf = (name: string, required: boolean, state: string, ctx: z.RefinementCtx): Check => {
  const outcome = OUTCOMES.get(state);
  if (outcome !== undefined) return { name, required, outcome };
  ctx.addIssue({ code: "custom", message: `GitHub sent an unknown check state: ${state}` });
  return z.NEVER;
};

const context = z.union([
  z
    .object({
      __typename: z.literal("CheckRun"),
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      isRequired: z.boolean(),
    })
    .transform(({ name, status, conclusion, isRequired }, ctx) =>
      checkOf(name, isRequired, conclusion ?? status, ctx),
    ),
  z
    .object({
      __typename: z.literal("StatusContext"),
      context: z.string(),
      state: z.string(),
      isRequired: z.boolean(),
    })
    .transform(({ context: name, state, isRequired }, ctx) =>
      checkOf(name, isRequired, state, ctx),
    ),
]);

export const ChecksPage = z
  .object({
    statusCheckRollup: z.object({
      contexts: z.object({
        pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
        nodes: z.array(context),
      }),
    }),
  })
  .transform(({ statusCheckRollup: { contexts } }, ctx) => {
    const { hasNextPage, endCursor } = contexts.pageInfo;
    if (hasNextPage && endCursor === null) {
      ctx.addIssue({ code: "custom", message: "GitHub sent a next page without a cursor" });
      return z.NEVER;
    }
    return { checks: contexts.nodes, next: hasNextPage ? endCursor : null };
  });

export type ChecksPage = z.infer<typeof ChecksPage>;

export const CHECKS_PER_PAGE = 100;

export const checksFields = (number: number, after: string) =>
  `statusCheckRollup { contexts(first: ${CHECKS_PER_PAGE}, after: ${after}) { ` +
  "pageInfo { hasNextPage endCursor } nodes { __typename " +
  `... on CheckRun { name status conclusion isRequired(pullRequestNumber: ${number}) } ` +
  `... on StatusContext { context state isRequired(pullRequestNumber: ${number}) } } } }`;

const isGate = (check: Check) => APPROVAL_GATES.has(check.name);

export const signalsOf = (checks: readonly Check[]): CheckSignals => ({
  failing: checks.some((check) => check.required && check.outcome === "failed"),
  running: checks.some((check) => check.required && check.outcome === "running" && !isGate(check)),
  awaitingApproval: checks.some((check) => isGate(check) && check.outcome === "running"),
});

export const optionalFailures = (checks: readonly Check[]): readonly string[] => [
  ...new Set(
    checks.flatMap((check) => (!check.required && check.outcome === "failed" ? [check.name] : [])),
  ),
];
