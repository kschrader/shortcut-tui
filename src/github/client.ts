import { z } from "zod";
import { classify, RawPullRequestSchema } from "./pull-request-state.ts";
import {
  pullRequestKey,
  type GitHubClient,
  type PullRequestRef,
  type PullRequestState,
} from "./types.ts";

export type GhOutput = { exitCode: number; stdout: string; stderr: string };
export type GhRunner = (args: readonly string[]) => Promise<GhOutput>;

export const GH_SETUP_HINT = "GitHub status needs the gh CLI: gh auth login";

const GH_AUTH_REQUIRED_EXIT_CODE = 4;
const PULL_REQUESTS_PER_QUERY = 50;
const PULL_REQUEST_FIELDS =
  "state merged isDraft reviewDecision mergeable mergeStateStatus statusCheckRollup { state }";

export const ghRunner =
  (executable = "gh"): GhRunner =>
  async (args) => {
    const gh = Bun.spawn([executable, ...args], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(gh.stdout).text(),
      new Response(gh.stderr).text(),
      gh.exited,
    ]);
    return { exitCode, stdout, stderr };
  };

const GraphQlResponse = z.object({
  data: z
    .record(z.string(), z.record(z.string(), RawPullRequestSchema.nullable()).nullable())
    .nullable()
    .optional(),
});

type Repository = { owner: string; repo: string; numbers: readonly number[] };

const byRepository = (refs: readonly PullRequestRef[]): Repository[] => {
  const repositories = new Map<string, { owner: string; repo: string; numbers: Set<number> }>();
  for (const { owner, repo, number } of refs) {
    const key = `${owner}/${repo}`.toLowerCase();
    const repository = repositories.get(key) ?? { owner, repo, numbers: new Set<number>() };
    repository.numbers.add(number);
    repositories.set(key, repository);
  }
  return [...repositories.values()].map(({ owner, repo, numbers }) => ({
    owner,
    repo,
    numbers: [...numbers],
  }));
};

const chunked = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

const queriesFor = (refs: readonly PullRequestRef[]): Repository[][] => {
  const queries: Repository[][] = [];
  let current: Repository[] = [];
  let size = 0;
  for (const { owner, repo, numbers } of byRepository(refs)) {
    for (const part of chunked(numbers, PULL_REQUESTS_PER_QUERY)) {
      if (size + part.length > PULL_REQUESTS_PER_QUERY) {
        queries.push(current);
        current = [];
        size = 0;
      }
      current.push({ owner, repo, numbers: part });
      size += part.length;
    }
  }
  if (current.length > 0) queries.push(current);
  return queries;
};

const queryArgs = (repositories: readonly Repository[]): string[] => {
  const variables = repositories.flatMap((_, i) => [`$o${i}: String!`, `$n${i}: String!`]);
  const selections = repositories.map(({ numbers }, i) => {
    const pulls = numbers.map(
      (number) => `p${number}: pullRequest(number: ${number}) { ${PULL_REQUEST_FIELDS} }`,
    );
    return `r${i}: repository(owner: $o${i}, name: $n${i}) { ${pulls.join(" ")} }`;
  });
  const query = `query(${variables.join(", ")}) { ${selections.join(" ")} }`;
  return [
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    ...repositories.flatMap(({ owner, repo }, i) => [
      "-f",
      `o${i}=${owner}`,
      "-f",
      `n${i}=${repo}`,
    ]),
  ];
};

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

const isMissingExecutable = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const ask = async (run: GhRunner, args: readonly string[]): Promise<GhOutput> => {
  try {
    return await run(args);
  } catch (error) {
    if (isMissingExecutable(error)) throw new Error(GH_SETUP_HINT, { cause: error });
    throw error;
  }
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parseOutput = ({ exitCode, stdout, stderr }: GhOutput) => {
  if (exitCode === GH_AUTH_REQUIRED_EXIT_CODE) throw new Error(GH_SETUP_HINT);
  const parsed = GraphQlResponse.safeParse(parseJson(stdout));
  if (parsed.success && parsed.data.data !== undefined && parsed.data.data !== null) {
    return parsed.data.data;
  }
  if (exitCode !== 0) {
    throw new Error(`GitHub query failed: ${firstLine(stderr) || `gh exited ${exitCode}`}`);
  }
  throw new Error("GitHub sent an unexpected response");
};

const statesOf = async (
  run: GhRunner,
  repositories: readonly Repository[],
): Promise<[string, PullRequestState][]> => {
  const data = parseOutput(await ask(run, queryArgs(repositories)));
  return repositories.flatMap(({ owner, repo, numbers }, i) =>
    numbers.map((number): [string, PullRequestState] => {
      const raw = data[`r${i}`]?.[`p${number}`] ?? null;
      return [pullRequestKey({ owner, repo, number }), raw === null ? "unknown" : classify(raw)];
    }),
  );
};

export const createGitHubClient = (run: GhRunner = ghRunner()): GitHubClient => ({
  async pullRequestStates(refs) {
    const answers = await Promise.all(
      queriesFor(refs).map((repositories) => statesOf(run, repositories)),
    );
    return new Map(answers.flat());
  },
});
