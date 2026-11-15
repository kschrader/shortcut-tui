import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitHubClient, ghRunner, GH_SETUP_HINT } from "./client.ts";
import { fakeGitHub, flags, raw, ref } from "./gh-stub.ts";
import { pullRequestKey, type GitHubClient, type PullRequestRef } from "./types.ts";

const statesOf = async (client: GitHubClient, refs: readonly PullRequestRef[]) =>
  new Map([...(await client.pullRequests(refs))].map(([key, { state }]) => [key, state]));

const badGateway = (status: number) => ({
  exitCode: 1,
  stdout: "",
  stderr: `HTTP ${status}: Bad Gateway (https://api.github.com/graphql)\n`,
});

const rejection = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected the promise to reject with an Error");
};

test("one gh call classifies every pull request across repositories", async () => {
  const { calls, client } = fakeGitHub({
    "exampleco/storefront#3917": raw({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
    "exampleco/storefront#3204": raw({ state: "CLOSED" }),
    "acme/web.app#12": raw({ mergeStateStatus: "CLEAN" }),
  });
  const states = await statesOf(client, [
    ref("storefront", 3917),
    ref("storefront", 3204),
    ref("storefront", 3917),
    ref("web.app", 12, "acme"),
  ]);
  expect(calls.length).toBe(1);
  expect(calls[0]?.slice(0, 2)).toEqual(["api", "graphql"]);
  expect(states).toEqual(
    new Map([
      [pullRequestKey(ref("storefront", 3917)), "conflicts"],
      [pullRequestKey(ref("storefront", 3204)), "closed"],
      [pullRequestKey(ref("web.app", 12, "acme")), "ready"],
    ]),
  );
});

test("owner and repository names travel as variables, not inside the query", async () => {
  const { calls, client } = fakeGitHub({ 'evil/x") { viewer { login } } ##1': raw() });
  await client.pullRequests([ref('x") { viewer { login } } #', 1, "evil")]);
  const query = flags(calls[0] ?? []).get("query") ?? "";
  expect(query).not.toContain("evil");
  expect(query).not.toContain("viewer { login }");
});

test("pull requests GitHub cannot resolve are left unanswered while the rest still classify", async () => {
  const { client } = fakeGitHub({
    "exampleco/storefront#1": raw({ merged: true, state: "MERGED" }),
  });
  const states = await statesOf(client, [
    ref("storefront", 1),
    ref("storefront", 2),
    ref("deleted-repo", 3),
  ]);
  expect(states).toEqual(new Map([[pullRequestKey(ref("storefront", 1)), "merged"]]));
});

test("many pull requests are split into concurrent queries of at most 10", async () => {
  const numbers = Array.from({ length: 25 }, (_, i) => i + 1);
  const { calls, concurrency, client } = fakeGitHub(
    Object.fromEntries(numbers.map((n) => [`exampleco/storefront#${n}`, raw({ isDraft: true })])),
  );
  const states = await statesOf(
    client,
    numbers.map((n) => ref("storefront", n)),
  );
  expect(calls.length).toBe(3);
  expect(concurrency.max).toBe(3);
  expect(states.size).toBe(25);
  expect(new Set(states.values())).toEqual(new Set(["draft"]));
});

test("no pull requests means no gh call", async () => {
  const { calls, client } = fakeGitHub({});
  expect((await client.pullRequests([])).size).toBe(0);
  expect(calls).toEqual([]);
});

test("a missing gh executable rejects with the setup hint", async () => {
  const client = createGitHubClient({ run: ghRunner("shortcut-tui-no-such-gh") });
  expect((await rejection(client.pullRequests([ref("storefront", 1)]))).message).toBe(
    GH_SETUP_HINT,
  );
});

test("a logged-out gh rejects with the setup hint", async () => {
  const client = createGitHubClient({
    run: async () => ({
      exitCode: 4,
      stdout: "",
      stderr: "To get started with GitHub CLI, please run:  gh auth login\n",
    }),
  });
  expect((await rejection(client.pullRequests([ref("storefront", 1)]))).message).toBe(
    GH_SETUP_HINT,
  );
});

test("any other gh failure names gh's own error", async () => {
  const client = createGitHubClient({
    run: async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "HTTP 502: Bad Gateway (https://api.github.com/graphql)\nretry later\n",
    }),
  });
  expect((await rejection(client.pullRequests([ref("storefront", 1)]))).message).toBe(
    "GitHub query failed: HTTP 502: Bad Gateway (https://api.github.com/graphql)",
  );
});

test("pull requests whose mergeability GitHub is still computing are asked about once more", async () => {
  const computing = raw({ mergeable: "UNKNOWN", statusCheckRollup: { state: "SUCCESS" } });
  const { calls, client } = fakeGitHub(
    {
      "exampleco/storefront#3729": computing,
      "exampleco/storefront#3911": raw({ mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" }),
      "exampleco/storefront#3960": raw({ mergeable: "UNKNOWN", isDraft: true }),
    },
    {
      "exampleco/storefront#3729": raw({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
    },
  );
  const states = await statesOf(client, [
    ref("storefront", 3729),
    ref("storefront", 3911),
    ref("storefront", 3960),
  ]);
  expect(calls.length).toBe(2);
  expect(flags(calls[1] ?? []).get("query")).not.toContain("3911");
  expect([...states.values()]).toEqual(["conflicts", "ready", "draft"]);
});

test("pull requests whose merge state GitHub is still computing are asked about once more", async () => {
  const { calls, client } = fakeGitHub(
    { "exampleco/storefront#3940": raw({ mergeStateStatus: "UNKNOWN" }) },
    { "exampleco/storefront#3940": raw({ mergeStateStatus: "BEHIND" }) },
  );
  const states = await statesOf(client, [ref("storefront", 3940)]);
  expect(calls.length).toBe(2);
  expect([...states.values()]).toEqual(["behind"]);
});

test("a failed query leaves only its own pull requests unanswered", async () => {
  const numbers = Array.from({ length: 11 }, (_, i) => i + 1);
  const github = fakeGitHub(
    Object.fromEntries(
      numbers.map((n) => [`exampleco/storefront#${n}`, raw({ mergeStateStatus: "CLEAN" })]),
    ),
  );
  const client = createGitHubClient({
    run: async (args, signal) =>
      (flags(args).get("query") ?? "").includes("p11:")
        ? badGateway(502)
        : github.run(args, signal),
    recheckAfterMs: 0,
  });
  const states = await statesOf(
    client,
    numbers.map((n) => ref("storefront", n)),
  );
  expect(states).toEqual(
    new Map(numbers.slice(0, 10).map((n) => [pullRequestKey(ref("storefront", n)), "ready"])),
  );
});

test("when every query fails, the first one's error rejects", async () => {
  const client = createGitHubClient({
    run: async (args) =>
      (flags(args).get("query") ?? "").includes("p11:") ? badGateway(503) : badGateway(502),
  });
  const refs = Array.from({ length: 11 }, (_, i) => ref("storefront", i + 1));
  expect((await rejection(client.pullRequests(refs))).message).toBe(
    "GitHub query failed: HTTP 502: Bad Gateway (https://api.github.com/graphql)",
  );
});

test("a failed second look keeps the first round's answers", async () => {
  const github = fakeGitHub({
    "exampleco/storefront#3729": raw({ mergeable: "UNKNOWN", reviewDecision: "CHANGES_REQUESTED" }),
    "exampleco/storefront#3911": raw({ mergeStateStatus: "CLEAN" }),
  });
  let calls = 0;
  const client = createGitHubClient({
    run: async (args, signal) => {
      calls += 1;
      return calls === 1 ? github.run(args, signal) : badGateway(502);
    },
    recheckAfterMs: 0,
  });
  const states = await statesOf(client, [ref("storefront", 3729), ref("storefront", 3911)]);
  expect(calls).toBe(2);
  expect([...states.values()]).toEqual(["changes-requested", "ready"]);
});

test("a second look that loses a pull request keeps its first answer", async () => {
  const { calls, client } = fakeGitHub(
    {
      "exampleco/storefront#3729": raw({
        mergeable: "UNKNOWN",
        reviewDecision: "CHANGES_REQUESTED",
      }),
      "exampleco/storefront#3730": raw({ mergeable: "UNKNOWN" }),
    },
    { "exampleco/storefront#3730": raw({ mergeStateStatus: "CLEAN" }) },
  );
  const states = await statesOf(client, [ref("storefront", 3729), ref("storefront", 3730)]);
  expect(calls.length).toBe(2);
  expect([...states.values()]).toEqual(["changes-requested", "ready"]);
});

test("gh that cannot see any requested repository rejects with GitHub's error", async () => {
  const message = "Could not resolve to a Repository with the name 'exampleco/storefront'.";
  const client = createGitHubClient({
    run: async () => ({
      exitCode: 1,
      stdout: JSON.stringify({ data: { r0: null }, errors: [{ type: "NOT_FOUND", message }] }),
      stderr: `gh: ${message} (NOT_FOUND)\n`,
    }),
  });
  expect(
    (await rejection(client.pullRequests([ref("storefront", 1), ref("storefront", 2)]))).message,
  ).toBe(`GitHub query failed: ${message}`);
});

test("gh that never answers is abandoned after the timeout", async () => {
  const signals: AbortSignal[] = [];
  const client = createGitHubClient({
    run: (_, signal) => {
      signals.push(signal);
      return new Promise(() => {});
    },
    timeoutMs: 10,
  });
  const error = await rejection(client.pullRequests([ref("storefront", 1)]));
  expect(error.message).toContain("gh did not answer");
  expect(signals.map((signal) => signal.aborted)).toEqual([true]);
});

test("a hung gh process is killed at the timeout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "shortcut-tui-gh-"));
  const pidFile = join(dir, "pid");
  const gh = join(dir, "gh");
  writeFileSync(gh, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 30\n`);
  chmodSync(gh, 0o755);
  const slowMachineStartupMs = 2000;
  const client = createGitHubClient({ run: ghRunner(gh), timeoutMs: slowMachineStartupMs });
  await rejection(client.pullRequests([ref("storefront", 1)]));
  const pid = Number(readFileSync(pidFile, "utf8"));
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (let waited = 0; alive() && waited < 2000; waited += 20) await Bun.sleep(20);
  expect(alive()).toBe(false);
});

test("many queries keep at most 4 gh processes running at once", async () => {
  const numbers = Array.from({ length: 95 }, (_, i) => i + 1);
  const { calls, concurrency, client } = fakeGitHub(
    Object.fromEntries(numbers.map((n) => [`exampleco/storefront#${n}`, raw({ isDraft: true })])),
  );
  const states = await statesOf(
    client,
    numbers.map((n) => ref("storefront", n)),
  );
  expect(calls.length).toBe(10);
  expect(concurrency.max).toBe(4);
  expect(states.size).toBe(95);
});
