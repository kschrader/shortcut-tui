import { DEMO_REPOSITORY } from "../shortcut/fake.ts";
import { pullRequestKey, type GitHubClient, type PullRequestState } from "./types.ts";

export type FakeGitHubOptions = { delayMs?: number };

const demoStates: Record<number, PullRequestState> = {
  3902: "merged",
  3948: "merged",
  3951: "ready",
  3955: "checks-failing",
  3960: "draft",
  3962: "checks-running",
  3963: "changes-requested",
};

const states: ReadonlyMap<string, PullRequestState> = new Map(
  Object.entries(demoStates).map(([number, state]) => [
    pullRequestKey({ ...DEMO_REPOSITORY, number: Number(number) }),
    state,
  ]),
);

export const createFakeGitHubClient = ({ delayMs = 0 }: FakeGitHubOptions = {}): GitHubClient => ({
  async pullRequestStates(refs) {
    if (delayMs > 0) await Bun.sleep(delayMs);
    return new Map(
      refs.map((ref) => {
        const key = pullRequestKey(ref);
        return [key, states.get(key) ?? "unknown"];
      }),
    );
  },
});
