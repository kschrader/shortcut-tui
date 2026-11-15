import { expect, test } from "bun:test";
import { createGitHubClient } from "./client.ts";
import { fakeGitHubFor, flags, raw, ref, type GhAccount } from "./gh-stub.ts";
import { pullRequestKey, type Reviews } from "./types.ts";

const kurt: GhAccount = {
  login: "kschrader",
  teams: { exampleco: ["engineering", "managers"] },
};

const user = (login: string) => ({ requestedReviewer: { __typename: "User", login } });
const team = (slug: string) => ({ requestedReviewer: { __typename: "Team", slug } });
const requesting = (...nodes: unknown[]) => raw({ reviewRequests: { nodes } });

const review = (state: string, login: string) => ({ state, author: { login } });

const reviewsOf = async (account: GhAccount, pullRequest: Record<string, unknown>) => {
  const github = fakeGitHubFor(account, { "exampleco/storefront#1": pullRequest });
  const answers = await github.client.pullRequests([ref("storefront", 1)]);
  return answers.get(pullRequestKey(ref("storefront", 1)))?.reviews;
};

const identityQueries = (calls: readonly string[][]) =>
  calls
    .map((args) => flags(args).get("query") ?? "")
    .filter((query) => !query.includes("repository("));

test("a review requested from you by login reaches you", async () => {
  expect(await reviewsOf(kurt, requesting(user("KSchrader"), user("andreas")))).toEqual({
    requested: [
      { kind: "user", login: "KSchrader", reachesYou: "yes" },
      { kind: "user", login: "andreas", reachesYou: "no" },
    ],
    submitted: [],
  });
});

test("a review requested from one of your teams reaches you through that team", async () => {
  const reviews = await reviewsOf(kurt, requesting(team("frontend"), team("engineering")));
  expect(reviews?.requested).toEqual([
    { kind: "team", slug: "frontend", reachesYou: "no" },
    { kind: "team", slug: "engineering", reachesYou: "yes" },
  ]);
});

test("a team request on your own pull request does not reach you", async () => {
  const yours = raw({
    author: { login: "kschrader" },
    reviewRequests: { nodes: [team("engineering")] },
  });
  expect((await reviewsOf(kurt, yours))?.requested).toEqual([
    { kind: "team", slug: "engineering", reachesYou: "no" },
  ]);
});

test("when your teams cannot be read, direct requests still reach you and team requests are unknown", async () => {
  const account = { ...kurt, teamsFail: true };
  const github = fakeGitHubFor(account, {
    "exampleco/storefront#1": requesting(user("kschrader"), team("engineering")),
    "exampleco/storefront#2": raw({ mergeStateStatus: "CLEAN" }),
  });
  const answers = await github.client.pullRequests([ref("storefront", 1), ref("storefront", 2)]);
  expect(answers.get(pullRequestKey(ref("storefront", 2)))?.state).toBe("ready");
  expect(answers.get(pullRequestKey(ref("storefront", 1)))?.reviews.requested).toEqual([
    { kind: "user", login: "kschrader", reachesYou: "yes" },
    { kind: "team", slug: "engineering", reachesYou: "unknown" },
  ]);
});

test("when your login cannot be read, every request is unknown and the pull requests still load", async () => {
  const reviews = await reviewsOf({}, requesting(user("kschrader")));
  expect(reviews?.requested).toEqual([{ kind: "user", login: "kschrader", reachesYou: "unknown" }]);
});

test("your login and teams are asked once per organization across loads", async () => {
  const github = fakeGitHubFor(kurt, {
    "exampleco/storefront#1": requesting(team("engineering")),
    "exampleco/web#2": requesting(team("frontend")),
    "acme/app#3": requesting(team("ops")),
  });
  const refs = [ref("storefront", 1), ref("web", 2), ref("app", 3, "acme")];
  await github.client.pullRequests(refs);
  await github.client.pullRequests(refs);
  const asked = identityQueries(github.calls);
  expect(asked.filter((query) => query.includes("viewer { login }")).length).toBe(1);
  const organizations = github.calls.flatMap((args) => flags(args).get("org") ?? []);
  expect(organizations.toSorted((a, b) => a.localeCompare(b))).toEqual(["acme", "exampleco"]);
});

test("a teams lookup that failed is asked again on the next load", async () => {
  let failing = true;
  const github = fakeGitHubFor(kurt, { "exampleco/storefront#1": requesting(team("engineering")) });
  const client = createGitHubClient({
    run: async (args, signal) =>
      failing && flags(args).has("org")
        ? { exitCode: 1, stdout: "", stderr: "HTTP 502: Bad Gateway\n" }
        : github.run(args, signal),
    recheckAfterMs: 0,
  });
  const reach = async () =>
    (await client.pullRequests([ref("storefront", 1)])).get(pullRequestKey(ref("storefront", 1)))
      ?.reviews.requested[0]?.reachesYou;
  expect(await reach()).toBe("unknown");
  failing = false;
  expect(await reach()).toBe("yes");
});

test("pull requests that ask no one for review never ask GitHub who you are", async () => {
  const github = fakeGitHubFor(kurt, { "exampleco/storefront#1": raw() });
  await github.client.pullRequests([ref("storefront", 1)]);
  expect(identityQueries(github.calls)).toEqual([]);
});

test("submitted reviews keep each reviewer's latest verdict and drop dismissed and pending ones", async () => {
  const reviews = await reviewsOf(
    kurt,
    raw({
      latestReviews: {
        nodes: [
          review("APPROVED", "priya"),
          review("CHANGES_REQUESTED", "sam"),
          review("COMMENTED", "alex"),
          review("DISMISSED", "zed"),
          review("PENDING", "kschrader"),
        ],
      },
    }),
  );
  const expected: Reviews = {
    requested: [],
    submitted: [
      { login: "priya", verdict: "approved" },
      { login: "sam", verdict: "changes-requested" },
      { login: "alex", verdict: "commented" },
    ],
  };
  expect(reviews).toEqual(expected);
});
