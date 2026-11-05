import { createGitHubClient, type GhOutput, type GhRunner } from "./client.ts";
import type { PullRequestRef } from "./types.ts";

export const ref = (repo: string, number: number, owner = "useshortcut"): PullRequestRef => ({
  owner,
  repo,
  number,
});

export const raw = (fields: Record<string, unknown> = {}) => ({
  state: "OPEN",
  merged: false,
  isDraft: false,
  reviewDecision: null,
  mergeable: "MERGEABLE",
  mergeStateStatus: "UNKNOWN",
  statusCheckRollup: null,
  author: { login: "andreas" },
  reviewRequests: { nodes: [] },
  latestReviews: { nodes: [] },
  ...fields,
});

export const flags = (args: readonly string[]) =>
  new Map(
    args.flatMap((arg, i) => {
      const separator = arg.indexOf("=");
      return args[i - 1] === "-f" ? [[arg.slice(0, separator), arg.slice(separator + 1)]] : [];
    }),
  );

type Table = Record<string, Record<string, unknown>>;

export type GhAccount = {
  login?: string;
  teams?: Record<string, readonly string[]>;
  teamsFail?: boolean;
};

const answer = (exitCode: number, body: unknown, stderr = ""): GhOutput => ({
  exitCode,
  stdout: JSON.stringify(body),
  stderr,
});

const accountAnswer = (account: GhAccount, query: string, org: string): GhOutput | null => {
  if (query.includes("viewer { login }")) {
    return account.login === undefined
      ? { exitCode: 1, stdout: "", stderr: "HTTP 502: Bad Gateway\n" }
      : answer(0, { data: { viewer: { login: account.login } } });
  }
  if (!query.includes("organization(login:")) return null;
  if (account.teamsFail === true) {
    return answer(1, {
      errors: [{ type: "INSUFFICIENT_SCOPES", message: "requires one of: read:org" }],
    });
  }
  const slugs = account.teams?.[org];
  return slugs === undefined
    ? answer(1, { data: { organization: null }, errors: [{ type: "NOT_FOUND" }] })
    : answer(0, { data: { organization: { teams: { nodes: slugs.map((slug) => ({ slug })) } } } });
};

const pullRequestAnswer = (pullRequests: Table, args: readonly string[]): GhOutput => {
  const variables = flags(args);
  const data: Record<string, Record<string, unknown> | null> = {};
  let missing = false;
  for (const segment of (variables.get("query") ?? "").split(/(?=\b\w+: repository\()/).slice(1)) {
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
  return answer(
    missing ? 1 : 0,
    { data, errors },
    missing ? "gh: Could not resolve to a Repository\n" : "",
  );
};

export const checkRun = (name: string, state: string, isRequired = false) => ({
  __typename: "CheckRun",
  name,
  status: state === "IN_PROGRESS" || state === "QUEUED" ? state : "COMPLETED",
  conclusion: state === "IN_PROGRESS" || state === "QUEUED" ? null : state,
  isRequired,
});

export const statusContext = (context: string, state: string, isRequired = false) => ({
  __typename: "StatusContext",
  context,
  state,
  isRequired,
});

const isPages = (value: unknown): value is readonly unknown[][] =>
  Array.isArray(value) && value.every((page) => Array.isArray(page));

const checksAnswer = (pullRequests: Table, args: readonly string[]): GhOutput => {
  const variables = flags(args);
  const query = variables.get("query") ?? "";
  const data: Record<string, Record<string, unknown>> = {};
  for (const [, alias, ownerVar, nameVar, pullAlias, number, afterVar] of query.matchAll(
    /(\w+): repository\(owner: \$(\w+), name: \$(\w+)\) \{ (\w+): pullRequest\(number: (\d+)\) \{.*?after: \$(\w+)/g,
  )) {
    if (alias === undefined || pullAlias === undefined || afterVar === undefined) continue;
    const key = `${variables.get(ownerVar ?? "") ?? ""}/${variables.get(nameVar ?? "") ?? ""}#${number ?? ""}`;
    const entry = pullRequests[key] ?? {};
    if (entry["checksFail"] === true)
      return { exitCode: 1, stdout: "", stderr: "HTTP 502: Bad Gateway\n" };
    const pages = entry["checks"];
    const at = Number(variables.get(afterVar) ?? "0");
    data[alias] = {
      [pullAlias]: isPages(pages)
        ? {
            statusCheckRollup: {
              contexts: {
                pageInfo: {
                  hasNextPage: at + 1 < pages.length,
                  endCursor: at + 1 < pages.length ? String(at + 1) : null,
                },
                nodes: pages[at] ?? [],
              },
            },
          }
        : { statusCheckRollup: null },
    };
  }
  return answer(0, { data });
};

export const fakeGitHubFor = (account: GhAccount, ...answersPerCall: [Table, ...Table[]]) => {
  const calls: string[][] = [];
  const concurrency = { now: 0, max: 0 };
  let pullRequestCalls = 0;
  const run: GhRunner = async (args) => {
    calls.push([...args]);
    concurrency.now += 1;
    concurrency.max = Math.max(concurrency.max, concurrency.now);
    await Bun.sleep(1);
    concurrency.now -= 1;
    const variables = flags(args);
    const about = accountAnswer(account, variables.get("query") ?? "", variables.get("org") ?? "");
    if (about !== null) return about;
    if ((variables.get("query") ?? "").includes("contexts(")) {
      return checksAnswer(
        answersPerCall[Math.max(pullRequestCalls - 1, 0)] ?? answersPerCall[0],
        args,
      );
    }
    pullRequestCalls += 1;
    return pullRequestAnswer(answersPerCall[pullRequestCalls - 1] ?? answersPerCall[0], args);
  };
  return { calls, concurrency, run, client: createGitHubClient({ run, recheckAfterMs: 0 }) };
};

export const fakeGitHub = (...answersPerCall: [Table, ...Table[]]) =>
  fakeGitHubFor({}, ...answersPerCall);
