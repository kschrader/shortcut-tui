export const approveArgs = (pullRequestId: string): string[] => [
  "api",
  "graphql",
  "-f",
  `query=mutation { addPullRequestReview(input: { pullRequestId: "${pullRequestId}", event: APPROVE }) { clientMutationId } }`,
];
