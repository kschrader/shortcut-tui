import { z } from "zod";
import { settleLimited } from "../concurrency.ts";
import {
  awaitsMergeability,
  classify,
  RawPullRequestSchema,
  type RawPullRequest,
} from "./pull-request-state.ts";
import { needsTeams, needsViewer, REVIEW_FIELDS, reviewsOf, type Viewer } from "./reviews.ts";
import { pullRequestKey, type GitHubClient, type PullRequestRef } from "./types.ts";

export type GhOutput = { exitCode: number; stdout: string; stderr: string };
export type GhRunner = (args: readonly string[], signal: AbortSignal) => Promise<GhOutput>;

export type GitHubClientOptions = { run?: GhRunner; recheckAfterMs?: number; timeoutMs?: number };

export const GH_SETUP_HINT = "GitHub status needs the gh CLI: gh auth login";

const GH_AUTH_REQUIRED_EXIT_CODE = 4;
const PULL_REQUESTS_PER_QUERY = 10;
const GH_QUERIES_IN_FLIGHT = 4;
const PULL_REQUEST_FIELDS = `state merged isDraft reviewDecision mergeable mergeStateStatus statusCheckRollup { state } ${REVIEW_FIELDS}`;
const VIEWER_QUERY = "query { viewer { login } }";
const TEAMS_QUERY =
  "query($org: String!, $login: String!) { organization(login: $org) { teams(first: 100, userLogins: [$login]) { nodes { slug } } } }";

export const ghRunner =
  (executable = "gh"): GhRunner =>
  async (args, signal) => {
    const gh = Bun.spawn([executable, ...args], {
      signal,
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
  errors: z
    .array(z.object({ message: z.string().optional() }))
    .optional()
    .catch(undefined),
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

type Gh = { run: GhRunner; timeoutMs: number };

const ask = async ({ run, timeoutMs }: Gh, args: readonly string[]): Promise<GhOutput> => {
  const timeout = new AbortController();
  const timer = setTimeout(() => {
    timeout.abort(new Error(`GitHub query failed: gh did not answer within ${timeoutMs / 1000} s`));
  }, timeoutMs);
  const timedOut = new Promise<never>((_, reject) => {
    timeout.signal.addEventListener("abort", () => {
      reject(timeout.signal.reason);
    });
  });
  try {
    return await Promise.race([run(args, timeout.signal), timedOut]);
  } catch (error) {
    if (isMissingExecutable(error)) throw new Error(GH_SETUP_HINT, { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const queryFailed = (message: string) => new Error(`GitHub query failed: ${message}`);

const parseOutput = ({ exitCode, stdout, stderr }: GhOutput) => {
  if (exitCode === GH_AUTH_REQUIRED_EXIT_CODE) throw new Error(GH_SETUP_HINT);
  const parsed = GraphQlResponse.safeParse(parseJson(stdout));
  if (parsed.success && parsed.data.data !== undefined && parsed.data.data !== null) {
    return { data: parsed.data.data, errors: parsed.data.errors ?? [] };
  }
  if (exitCode !== 0) throw queryFailed(firstLine(stderr) || `gh exited ${exitCode}`);
  throw new Error("GitHub sent an unexpected response");
};

type Answer = { ref: PullRequestRef; raw: RawPullRequest | null };

const answersTo = async (
  gh: Gh,
  repositories: readonly Repository[],
): Promise<[string, Answer][]> => {
  const output = await ask(gh, queryArgs(repositories));
  const { data, errors } = parseOutput(output);
  const answers = repositories.flatMap(({ owner, repo, numbers }, i) =>
    numbers.map((number): [string, Answer] => {
      const ref = { owner, repo, number };
      return [pullRequestKey(ref), { ref, raw: data[`r${i}`]?.[`p${number}`] ?? null }];
    }),
  );
  const [firstError] = errors;
  if (firstError !== undefined && answers.every(([, { raw }]) => raw === null)) {
    throw queryFailed(
      firstError.message ?? (firstLine(output.stderr) || `gh exited ${output.exitCode}`),
    );
  }
  return answers;
};

const lookUp = async (gh: Gh, refs: readonly PullRequestRef[]) => {
  const settled = await settleLimited(queriesFor(refs), GH_QUERIES_IN_FLIGHT, (repositories) =>
    answersTo(gh, repositories),
  );
  const answered = settled.flatMap((query) => (query.status === "fulfilled" ? query.value : []));
  const failures = settled.flatMap((query): unknown[] =>
    query.status === "rejected" ? [query.reason] : [],
  );
  if (answered.length === 0 && failures.length > 0) throw failures[0];
  return answered;
};

const ViewerAnswer = z.object({ data: z.object({ viewer: z.object({ login: z.string() }) }) });

const TeamsAnswer = z.object({
  data: z.object({
    organization: z
      .object({ teams: z.object({ nodes: z.array(z.object({ slug: z.string() })) }) })
      .nullable()
      .catch(null),
  }),
});

const answerTo = async <T>(
  gh: Gh,
  query: string,
  schema: z.ZodType<T>,
  variables: string[] = [],
) => {
  const output = await ask(gh, ["api", "graphql", "-f", `query=${query}`, ...variables]);
  if (output.exitCode === GH_AUTH_REQUIRED_EXIT_CODE) throw new Error(GH_SETUP_HINT);
  return schema.parse(parseJson(output.stdout));
};

const remembered = <T>(
  memory: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
  meanwhile: T,
): Promise<T> => {
  const known = memory.get(key);
  if (known !== undefined) return known;
  const loading = load().catch(() => {
    memory.delete(key);
    return meanwhile;
  });
  memory.set(key, loading);
  return loading;
};

type Identity = {
  login: Map<string, Promise<string | null>>;
  teams: Map<string, Promise<ReadonlySet<string> | null>>;
};

type Answered = { ref: PullRequestRef; raw: RawPullRequest };

const organizationOf = (ref: PullRequestRef) => ref.owner.toLowerCase();

const viewerFor = async (
  gh: Gh,
  identity: Identity,
  answered: readonly Answered[],
): Promise<(ref: PullRequestRef) => Viewer | null> => {
  if (!answered.some(({ raw }) => needsViewer(raw))) return () => null;
  const login = await remembered(
    identity.login,
    "viewer",
    async () => (await answerTo(gh, VIEWER_QUERY, ViewerAnswer)).data.viewer.login,
    null,
  );
  if (login === null) return () => null;
  const organizations = [
    ...new Set(answered.flatMap(({ ref, raw }) => (needsTeams(raw) ? [organizationOf(ref)] : []))),
  ];
  const teams = await settleLimited(organizations, GH_QUERIES_IN_FLIGHT, (organization) =>
    remembered(
      identity.teams,
      organization,
      async () => {
        const { data } = await answerTo(gh, TEAMS_QUERY, TeamsAnswer, [
          "-f",
          `org=${organization}`,
          "-f",
          `login=${login}`,
        ]);
        return data.organization === null
          ? null
          : new Set(data.organization.teams.nodes.map(({ slug }) => slug.toLowerCase()));
      },
      null,
    ),
  );
  const teamsOf = new Map(
    organizations.map((organization, i) => {
      const settled = teams[i];
      return [organization, settled?.status === "fulfilled" ? settled.value : null];
    }),
  );
  return (ref) => ({ login, teams: teamsOf.get(organizationOf(ref)) ?? null });
};

const withMergeability = async (
  gh: Gh,
  refs: readonly PullRequestRef[],
  recheckAfterMs: number,
) => {
  const answers = new Map(await lookUp(gh, refs));
  const computing = [...answers.values()].flatMap(({ ref, raw }) =>
    raw !== null && awaitsMergeability(raw) ? [ref] : [],
  );
  if (computing.length > 0) {
    await Bun.sleep(recheckAfterMs);
    const rechecked = await lookUp(gh, computing).catch(() => []);
    for (const [key, answer] of rechecked) {
      if (answer.raw !== null) answers.set(key, answer);
    }
  }
  return [...answers.values()].flatMap(({ ref, raw }) => (raw === null ? [] : [{ ref, raw }]));
};

export const createGitHubClient = ({
  run = ghRunner(),
  recheckAfterMs = 2000,
  timeoutMs = 20_000,
}: GitHubClientOptions = {}): GitHubClient => {
  const gh = { run, timeoutMs };
  const identity: Identity = { login: new Map(), teams: new Map() };
  return {
    async pullRequests(refs) {
      const answered = await withMergeability(gh, refs, recheckAfterMs);
      const viewerOf = await viewerFor(gh, identity, answered);
      return new Map(
        answered.map(({ ref, raw }) => [
          pullRequestKey(ref),
          { state: classify(raw), reviews: reviewsOf(raw, viewerOf(ref)) },
        ]),
      );
    },
  };
};
