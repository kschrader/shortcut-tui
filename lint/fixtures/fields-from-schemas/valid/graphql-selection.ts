export const PULL_REQUEST_FIELDS = "state merged isDraft reviewDecision mergeable";
export const REVIEW_FIELDS = `reviewRequests(first: 20) { nodes { requestedReviewer { __typename } } }`;
