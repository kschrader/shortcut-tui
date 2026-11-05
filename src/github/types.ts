export type PullRequestRef = { owner: string; repo: string; number: number };

export type PullRequestState =
  | "merged"
  | "closed"
  | "draft"
  | "conflicts"
  | "checks-failing"
  | "changes-requested"
  | "behind"
  | "ready"
  | "checks-running"
  | "needs-review"
  | "blocked"
  | "unknown";

export type ReachesYou = "yes" | "no" | "unknown";

export type ReviewRequest =
  | { kind: "user"; login: string; reachesYou: ReachesYou }
  | { kind: "team"; slug: string; reachesYou: ReachesYou };

export type Verdict = "approved" | "changes-requested" | "commented";

export type SubmittedReview = { login: string; verdict: Verdict };

export type Reviews = {
  requested: readonly ReviewRequest[];
  submitted: readonly SubmittedReview[];
};

export type GitHubPullRequest = {
  state: PullRequestState;
  reviews: Reviews;
  optionalFailing: readonly string[];
};

export type GitHubPullRequests = ReadonlyMap<string, GitHubPullRequest>;

export type GitHubClient = {
  pullRequests(refs: readonly PullRequestRef[]): Promise<GitHubPullRequests>;
};

export const pullRequestKey = ({ owner, repo, number }: PullRequestRef): string =>
  `${owner}/${repo}#${String(number)}`.toLowerCase();
