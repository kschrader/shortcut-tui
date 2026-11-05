import { expect, test } from "bun:test";
import { checkRun, fakeGitHub, flags, raw, ref, statusContext } from "./gh-stub.ts";
import { pullRequestKey, type PullRequestState } from "./types.ts";

const rollup = (state: string) => ({ statusCheckRollup: { state } });

const checkQueries = (calls: readonly string[][]) =>
  calls.filter((args) => (flags(args).get("query") ?? "").includes("contexts("));

const stateOf = async (github: ReturnType<typeof fakeGitHub>, number = 4044) =>
  (await github.client.pullRequests([ref("monorepo", number)])).get(
    pullRequestKey(ref("monorepo", number)),
  )?.state;

test("green, absent, and undecidable rollups ask GitHub nothing more", async () => {
  const github = fakeGitHub({
    "useshortcut/monorepo#1": raw({ mergeStateStatus: "BLOCKED", ...rollup("SUCCESS") }),
    "useshortcut/monorepo#2": raw({ mergeStateStatus: "BLOCKED" }),
    "useshortcut/monorepo#3": raw({ isDraft: true, ...rollup("FAILURE") }),
    "useshortcut/monorepo#4": raw({
      mergeable: "CONFLICTING",
      mergeStateStatus: "DIRTY",
      ...rollup("FAILURE"),
    }),
    "useshortcut/monorepo#5": raw({ mergeStateStatus: "CLEAN", ...rollup("PENDING") }),
  });
  const states = await github.client.pullRequests([1, 2, 3, 4, 5].map((n) => ref("monorepo", n)));
  expect([...states.values()].map(({ state }) => state)).toEqual([
    "blocked",
    "blocked",
    "draft",
    "conflicts",
    "ready",
  ]);
  expect(github.calls).toHaveLength(1);
});

test("a failing rollup whose only failure is optional and whose review gate waits needs review (live #4044)", async () => {
  const github = fakeGitHub({
    "useshortcut/monorepo#4044": raw({ mergeStateStatus: "BLOCKED", ...rollup("FAILURE") }),
    "useshortcut/monorepo#4045": raw({
      mergeStateStatus: "BLOCKED",
      ...rollup("FAILURE"),
      checks: [
        [
          checkRun("type-check", "SUCCESS", true),
          checkRun("pr-preview", "FAILURE"),
          checkRun("lint", "SKIPPED"),
        ],
        [checkRun("review-gate", "IN_PROGRESS", true), statusContext("ci/deploy", "SUCCESS", true)],
      ],
    }),
  });
  expect(await stateOf(github, 4045)).toBe("needs-review");
  const [first, second] = checkQueries(github.calls);
  expect(checkQueries(github.calls)).toHaveLength(2);
  expect(flags(first ?? []).has("a0")).toBe(false);
  expect(flags(second ?? []).get("a0")).toBe("1");
  expect(flags(first ?? []).get("query")).toContain("isRequired(pullRequestNumber: 4045)");
});

test("a required failure on the second page of checks still fails the pull request", async () => {
  const github = fakeGitHub({
    "useshortcut/monorepo#4044": raw({
      mergeStateStatus: "BLOCKED",
      ...rollup("FAILURE"),
      checks: [
        [checkRun("pr-preview", "FAILURE"), checkRun("review-gate", "IN_PROGRESS", true)],
        [checkRun("vitest", "TIMED_OUT", true)],
      ],
    }),
  });
  expect(await stateOf(github)).toBe("checks-failing");
});

test("a required check still running keeps the pull request running; optional ones do not", async () => {
  const running = fakeGitHub({
    "useshortcut/monorepo#4044": raw({
      mergeStateStatus: "BLOCKED",
      ...rollup("PENDING"),
      checks: [[checkRun("vitest", "QUEUED", true), statusContext("ci/x", "SUCCESS", true)]],
    }),
  });
  expect(await stateOf(running)).toBe("checks-running");
  const optionalOnly = fakeGitHub({
    "useshortcut/monorepo#4044": raw({
      mergeStateStatus: "BLOCKED",
      ...rollup("PENDING"),
      checks: [[checkRun("vitest", "SUCCESS", true), statusContext("ci/preview", "PENDING")]],
    }),
  });
  expect(await stateOf(optionalOnly)).toBe("blocked");
});

test("a failed check query falls back to the rollup for its pull requests only", async () => {
  const numbers = Array.from({ length: 11 }, (_, i) => i + 1);
  const github = fakeGitHub(
    Object.fromEntries(
      numbers.map((n) => [
        `useshortcut/monorepo#${n}`,
        raw({
          mergeStateStatus: "BLOCKED",
          ...rollup("FAILURE"),
          ...(n === 11 ? { checksFail: true } : { checks: [[checkRun("pr-preview", "FAILURE")]] }),
        }),
      ]),
    ),
  );
  const states = await github.client.pullRequests(numbers.map((n) => ref("monorepo", n)));
  const blocked = new Map<string, PullRequestState>(
    numbers.slice(0, 10).map((n) => [pullRequestKey(ref("monorepo", n)), "blocked"]),
  );
  expect(new Map([...states].map(([key, { state }]) => [key, state]))).toEqual(
    new Map([...blocked, [pullRequestKey(ref("monorepo", 11)), "checks-failing"]]),
  );
  expect(checkQueries(github.calls)).toHaveLength(3);
});

test("checks GitHub cannot list or describe fall back to the rollup", async () => {
  const github = fakeGitHub({
    "useshortcut/monorepo#1": raw({ mergeStateStatus: "BLOCKED", ...rollup("PENDING") }),
    "useshortcut/monorepo#2": raw({
      mergeStateStatus: "BLOCKED",
      ...rollup("FAILURE"),
      checks: [[checkRun("pr-preview", "SOMETHING_NEW")]],
    }),
  });
  const states = await github.client.pullRequests([ref("monorepo", 1), ref("monorepo", 2)]);
  expect([...states.values()].map(({ state }) => state)).toEqual([
    "checks-running",
    "checks-failing",
  ]);
});
