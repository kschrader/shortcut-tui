import type { Cached, StoryPullRequests } from "../app/model.ts";
import type { ReviewRequest, Reviews, SubmittedReview, Verdict } from "../github/types.ts";
import type { StorySummary } from "../shortcut/types.ts";
import { storyPullRequests } from "./pull-requests.ts";

export const YOUR_REVIEW_MARK = "@";

const reachesYou = (request: ReviewRequest) => request.reachesYou === "yes";

export const asksForYourReview = (reviews: Reviews): boolean => reviews.requested.some(reachesYou);

export const awaitsYourReview = (
  story: StorySummary,
  pullRequests: Cached<StoryPullRequests>,
): boolean => {
  const list = storyPullRequests(story, pullRequests);
  if (list?.status !== "loaded") return false;
  return list.value.some(
    (pr) =>
      pr.state !== "merged" &&
      pr.state !== "closed" &&
      pr.reviews !== null &&
      asksForYourReview(pr.reviews),
  );
};

const nameOf = (request: ReviewRequest): string => {
  switch (request.kind) {
    case "user":
      return `@${request.login}`;
    case "team":
      return request.slug;
  }
};

const youVia = (request: ReviewRequest): string => {
  switch (request.kind) {
    case "user":
      return "you";
    case "team":
      return `you (via ${request.slug})`;
  }
};

const requestedFrom = (requested: readonly ReviewRequest[]): string => {
  const yours = requested.find(reachesYou);
  const others = requested.filter((request) => request !== yours).map(nameOf);
  const names = yours === undefined ? others : [youVia(yours), ...others];
  return `review requested from ${names.join(", ")}`;
};

const verdictLabels: readonly (readonly [Verdict, string])[] = [
  ["approved", "approved by"],
  ["changes-requested", "changes requested by"],
  ["commented", "commented by"],
];

const verdictsOf = (submitted: readonly SubmittedReview[]): string[] =>
  verdictLabels.flatMap(([verdict, label]) => {
    const logins = submitted.flatMap((review) =>
      review.verdict === verdict ? [`@${review.login}`] : [],
    );
    return logins.length === 0 ? [] : [`${label} ${logins.join(", ")}`];
  });

export const reviewSummary = ({ requested, submitted }: Reviews): string => {
  const parts = [
    ...(requested.length === 0 ? [] : [requestedFrom(requested)]),
    ...verdictsOf(submitted),
    ...(requested.some((request) => request.reachesYou === "unknown")
      ? ["could not tell which are for you"]
      : []),
  ];
  return parts.length === 0 ? "no review requested" : parts.join(" · ");
};
