import { expect, test } from "bun:test";
import { createGitHubClient, ghRunner, GH_SETUP_HINT, type GhRunner } from "./client.ts";
import { pullRequestKey, type PullRequestRef } from "./types.ts";

const ref = (repo: string, number: number, owner = "useshortcut"): PullRequestRef => ({
  owner,
  repo,
  number,
});

const raw = (fields: Record<string, unknown> = {}) => ({
  state: "OPEN",
  merged: false,
  isDraft: false,
  reviewDecision: null,
  mergeable: "UNKNOWN",
  mergeStateStatus: "UNKNOWN",
  statusCheckRollup: null,
  ...fields,
});

const flags = (args: readonly string[]) =>
  new Map(
    args.flatMap((arg, i) => {
      const separator = arg.indexOf("=");
      return args[i - 1] === "-f" ? [[arg.slice(0, separator), arg.slice(separator + 1)]] : [];
    }),
  );

const fakeGitHub = (pullRequests: Record<string, Record<string, unknown>>) => {
  const calls: string[][] = [];
  const run: GhRunner = async (args) => {
    calls.push([...args]);
    const variables = flags(args);
    const data: Record<string, Record<string, unknown> | null> = {};
    let missing = false;
    for (const segment of (variables.get("query") ?? "")
      .split(/(?=\b\w+: repository\()/)
      .slice(1)) {
      const [, alias, ownerVar, nameVar] =
        /^(\w+): repository\(owner: \$(\w+), name: \$(\w+)\)/.exec(segment) ?? [];
      if (alias === undefined || ownerVar === undefined || nameVar === undefined) continue;
      const repo = `${variables.get(ownerVar) ?? ""}/${variables.get(nameVar) ?? ""}`;
      const pulls = [...segment.matchAll(/(\w+): pullRequest\(number: (\d+)\)/g)];
      const known = pulls.some(([, , number]) => `${repo}#${number ?? ""}` in pullRequests);
      missing ||= !known;
      data[alias] = known
        ? Object.fromEntries(
            pulls.map(([, pullAlias, number]) => [
              pullAlias,
              pullRequests[`${repo}#${number ?? ""}`] ?? null,
            ]),
          )
        : null;
    }
    const errors = missing ? [{ type: "NOT_FOUND", message: "Could not resolve" }] : undefined;
    return {
      exitCode: missing ? 1 : 0,
      stdout: JSON.stringify({ data, errors }),
      stderr: missing ? "gh: Could not resolve to a Repository\n" : "",
    };
  };
  return { calls, client: createGitHubClient(run) };
};

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
    "useshortcut/monorepo#3917": raw({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
    "useshortcut/monorepo#3204": raw({ state: "CLOSED" }),
    "acme/web.app#12": raw({ mergeStateStatus: "CLEAN" }),
  });
  const states = await client.pullRequestStates([
    ref("monorepo", 3917),
    ref("monorepo", 3204),
    ref("monorepo", 3917),
    ref("web.app", 12, "acme"),
  ]);
  expect(calls.length).toBe(1);
  expect(calls[0]?.slice(0, 2)).toEqual(["api", "graphql"]);
  expect(states).toEqual(
    new Map([
      [pullRequestKey(ref("monorepo", 3917)), "conflicts"],
      [pullRequestKey(ref("monorepo", 3204)), "closed"],
      [pullRequestKey(ref("web.app", 12, "acme")), "ready"],
    ]),
  );
});

test("owner and repository names travel as variables, not inside the query", async () => {
  const { calls, client } = fakeGitHub({});
  await client.pullRequestStates([ref('x") { viewer { login } } #', 1, "evil")]);
  const query = flags(calls[0] ?? []).get("query") ?? "";
  expect(query).not.toContain("evil");
  expect(query).not.toContain("viewer");
});

test("pull requests GitHub cannot resolve are unknown while the rest still classify", async () => {
  const { client } = fakeGitHub({
    "useshortcut/monorepo#1": raw({ merged: true, state: "MERGED" }),
  });
  const states = await client.pullRequestStates([
    ref("monorepo", 1),
    ref("monorepo", 2),
    ref("deleted-repo", 3),
  ]);
  expect([...states.values()]).toEqual(["merged", "unknown", "unknown"]);
});

test("many pull requests are split into queries of at most 50", async () => {
  const numbers = Array.from({ length: 120 }, (_, i) => i + 1);
  const { calls, client } = fakeGitHub(
    Object.fromEntries(numbers.map((n) => [`useshortcut/monorepo#${n}`, raw({ isDraft: true })])),
  );
  const states = await client.pullRequestStates(numbers.map((n) => ref("monorepo", n)));
  expect(calls.length).toBe(3);
  expect(states.size).toBe(120);
  expect(new Set(states.values())).toEqual(new Set(["draft"]));
});

test("no pull requests means no gh call", async () => {
  const { calls, client } = fakeGitHub({});
  expect((await client.pullRequestStates([])).size).toBe(0);
  expect(calls).toEqual([]);
});

test("a missing gh executable rejects with the setup hint", async () => {
  const client = createGitHubClient(ghRunner("shortcut-tui-no-such-gh"));
  expect((await rejection(client.pullRequestStates([ref("monorepo", 1)]))).message).toBe(
    GH_SETUP_HINT,
  );
});

test("a logged-out gh rejects with the setup hint", async () => {
  const client = createGitHubClient(async () => ({
    exitCode: 4,
    stdout: "",
    stderr: "To get started with GitHub CLI, please run:  gh auth login\n",
  }));
  expect((await rejection(client.pullRequestStates([ref("monorepo", 1)]))).message).toBe(
    GH_SETUP_HINT,
  );
});

test("any other gh failure names gh's own error", async () => {
  const client = createGitHubClient(async () => ({
    exitCode: 1,
    stdout: "",
    stderr: "HTTP 502: Bad Gateway (https://api.github.com/graphql)\nretry later\n",
  }));
  expect((await rejection(client.pullRequestStates([ref("monorepo", 1)]))).message).toBe(
    "GitHub query failed: HTTP 502: Bad Gateway (https://api.github.com/graphql)",
  );
});
