import { DEMO_REPOSITORY } from "../shortcut/demo-workspace.ts";
import {
  pullRequestKey,
  type GitHubClient,
  type GitHubPullRequest,
  type PullRequestState,
  type Reviews,
} from "./types.ts";

export type FakeGitHubOptions = { delayMs?: number };

const noReviews: Reviews = { requested: [], submitted: [] };

const demo: Record<number, [PullRequestState, Reviews?, (readonly string[])?]> = {
  3902: ["merged", { requested: [], submitted: [{ login: "priya", verdict: "approved" }] }],
  3948: ["merged"],
  3951: ["ready", { requested: [], submitted: [{ login: "sam", verdict: "approved" }] }],
  3955: ["checks-failing"],
  3957: ["behind"],
  3958: ["blocked"],
  3960: ["draft"],
  3962: [
    "checks-running",
    { requested: [{ kind: "user", login: "alex", reachesYou: "no" }], submitted: [] },
  ],
  3963: [
    "changes-requested",
    { requested: [], submitted: [{ login: "priya", verdict: "changes-requested" }] },
  ],
  3964: ["conflicts"],
  3965: [
    "needs-review",
    { requested: [{ kind: "team", slug: "backend", reachesYou: "no" }], submitted: [] },
  ],
  3970: [
    "needs-review",
    {
      requested: [
        { kind: "team", slug: "engineering", reachesYou: "yes" },
        { kind: "user", login: "alex", reachesYou: "no" },
      ],
      submitted: [],
    },
    ["pr-preview"],
  ],
  3971: ["checks-running", { requested: [], submitted: [{ login: "alex", verdict: "commented" }] }],
  3980: ["merged"],
  3981: ["merged"],
  3982: ["closed"],
};

const answers: ReadonlyMap<string, GitHubPullRequest> = new Map(
  Object.entries(demo).map(([number, [state, reviews = noReviews, optionalFailing = []]]) => [
    pullRequestKey({ ...DEMO_REPOSITORY, number: Number(number) }),
    { state, reviews, optionalFailing },
  ]),
);

export const createFakeGitHubClient = ({ delayMs = 0 }: FakeGitHubOptions = {}): GitHubClient => ({
  async pullRequests(refs) {
    if (delayMs > 0) await Bun.sleep(delayMs);
    return new Map(
      refs.flatMap((ref) => {
        const key = pullRequestKey(ref);
        const answer = answers.get(key);
        return answer === undefined ? [] : [[key, answer]];
      }),
    );
  },
});
