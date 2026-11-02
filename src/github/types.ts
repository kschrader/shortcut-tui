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

export type PullRequestStates = ReadonlyMap<string, PullRequestState>;

export type GitHubClient = {
  pullRequestStates(refs: readonly PullRequestRef[]): Promise<PullRequestStates>;
};

export const pullRequestKey = ({ owner, repo, number }: PullRequestRef): string =>
  `${owner}/${repo}#${String(number)}`.toLowerCase();
