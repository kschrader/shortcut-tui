import { z } from "zod";
import type { ReachesYou, ReviewRequest, Reviews, SubmittedReview, Verdict } from "./types.ts";

const author = z.object({ login: z.string() });

const nodesOf = <T extends z.ZodType>(node: T) =>
  z
    .object({ nodes: z.array(node) })
    .transform(({ nodes }) => nodes)
    .catch([]);

type Requested = { kind: "user"; login: string } | { kind: "team"; slug: string };

const requestedReviewer = z
  .union([
    z
      .object({ __typename: z.enum(["User", "Bot"]), login: z.string() })
      .transform(({ login }): Requested => ({ kind: "user", login })),
    z
      .object({ __typename: z.literal("Team"), slug: z.string() })
      .transform(({ slug }): Requested => ({ kind: "team", slug })),
  ])
  .nullable()
  .catch(null);

const verdicts = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  COMMENTED: "commented",
} as const satisfies Record<string, Verdict>;

const submittedReview = z.object({
  state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]).nullable().catch(null),
  author: author.nullable().catch(null),
});

export const reviewFields = {
  author: author.nullable().catch(null),
  reviewRequests: nodesOf(z.object({ requestedReviewer })).transform((nodes) =>
    nodes.flatMap(({ requestedReviewer: reviewer }) => (reviewer === null ? [] : [reviewer])),
  ),
  latestReviews: nodesOf(submittedReview).transform((nodes) =>
    nodes.flatMap(({ state, author: reviewer }): SubmittedReview[] =>
      state === null || reviewer === null
        ? []
        : [{ login: reviewer.login, verdict: verdicts[state] }],
    ),
  ),
};

export const REVIEW_FIELDS =
  "author { login } " +
  "reviewRequests(first: 10) { nodes { requestedReviewer { __typename " +
  "... on User { login } ... on Team { slug } ... on Bot { login } } } } " +
  "latestReviews(first: 10) { nodes { state author { login } } }";

export type Viewer = { login: string; teams: ReadonlySet<string> | null };

type RawReviews = {
  author: { login: string } | null;
  reviewRequests: readonly Requested[];
  latestReviews: readonly SubmittedReview[];
};

const sameLogin = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const reach = (request: Requested, viewer: Viewer): ReachesYou => {
  switch (request.kind) {
    case "user":
      return sameLogin(request.login, viewer.login) ? "yes" : "no";
    case "team":
      if (viewer.teams === null) return "unknown";
      return viewer.teams.has(request.slug.toLowerCase()) ? "yes" : "no";
  }
};

const reachFor =
  (raw: RawReviews, viewer: Viewer | null) =>
  (request: Requested): ReachesYou => {
    if (viewer === null) return "unknown";
    if (raw.author !== null && sameLogin(raw.author.login, viewer.login)) return "no";
    return reach(request, viewer);
  };

export const reviewsOf = (raw: RawReviews, viewer: Viewer | null): Reviews => {
  const reachesYou = reachFor(raw, viewer);
  return {
    requested: raw.reviewRequests.map((request): ReviewRequest => ({
      ...request,
      reachesYou: reachesYou(request),
    })),
    submitted: raw.latestReviews,
  };
};

export const needsViewer = (raw: RawReviews): boolean => raw.reviewRequests.length > 0;

export const needsTeams = (raw: RawReviews): boolean =>
  raw.reviewRequests.some((request) => request.kind === "team");
