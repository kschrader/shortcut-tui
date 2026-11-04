import { settleLimited } from "../concurrency.ts";
import { pullRequestKey, type GitHubClient, type PullRequestState } from "../github/types.ts";
import type {
  LinkedPullRequest,
  ShortcutClient,
  StoryId,
  StorySummary,
} from "../shortcut/types.ts";
import type { Effect, Msg, Settled, StoryPullRequests } from "./model.ts";

export type Clients = { shortcut: ShortcutClient; github: GitHubClient };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const shortcutState = ({ closed, draft }: LinkedPullRequest): PullRequestState => {
  if (closed) return "closed";
  return draft ? "draft" : "unknown";
};

const SHORTCUT_REQUESTS_IN_FLIGHT = 6;

const storiesMatching = async (
  shortcut: ShortcutClient,
  queries: readonly string[],
): Promise<readonly StorySummary[]> => {
  const answers = await settleLimited(queries, SHORTCUT_REQUESTS_IN_FLIGHT, (query) =>
    shortcut.searchStories(query),
  );
  const merged = new Map<StoryId, StorySummary>();
  for (const answer of answers) {
    if (answer.status === "rejected") throw answer.reason;
    for (const story of answer.value) merged.set(story.id, story);
  }
  return [...merged.values()];
};

const pullRequestsOf = async (
  { shortcut, github }: Clients,
  storyIds: readonly StoryId[],
): Promise<StoryPullRequests> => {
  const listed = await settleLimited(storyIds, SHORTCUT_REQUESTS_IN_FLIGHT, (id) =>
    shortcut.listPullRequests(id),
  );
  const lists = listed.map((result, i): [StoryId, Settled<readonly LinkedPullRequest[]>] => [
    storyIds[i],
    result.status === "fulfilled"
      ? { status: "loaded", value: result.value }
      : { status: "failed", message: messageOf(result.reason) },
  ]);
  const failures = lists.flatMap(([, list]) => (list.status === "failed" ? [list.message] : []));
  if (failures.length === lists.length && failures[0] !== undefined) throw new Error(failures[0]);
  const answers = await github.pullRequests(
    lists.flatMap(([, list]) =>
      list.status === "loaded" ? list.value.flatMap((pr) => pr.github ?? []) : [],
    ),
  );
  return new Map(
    lists.map(([id, list]) => [
      id,
      list.status === "failed"
        ? list
        : {
            status: "loaded",
            value: list.value.map((pr) => {
              const answer =
                pr.github === null ? undefined : answers.get(pullRequestKey(pr.github));
              return {
                ...pr,
                state: answer?.state ?? shortcutState(pr),
                reviews: answer?.reviews ?? null,
              };
            }),
          },
    ]),
  );
};

const runEffectUnsafe = async (clients: Clients, effect: Effect, now: () => Date): Promise<Msg> => {
  switch (effect.type) {
    case "loadWorkspace":
      return {
        type: "workspaceLoaded",
        requestId: effect.requestId,
        workspace: await clients.shortcut.loadWorkspace(),
      };
    case "searchStories":
      return {
        type: "searchSucceeded",
        requestId: effect.requestId,
        stories: await storiesMatching(clients.shortcut, effect.queries),
        loadedAt: now(),
      };
    case "getStory":
      return {
        type: "detailSucceeded",
        requestId: effect.requestId,
        story: await clients.shortcut.getStory(effect.storyId),
      };
    case "loadPullRequests":
      return {
        type: "pullRequestsLoaded",
        requestId: effect.requestId,
        pullRequests: await pullRequestsOf(clients, effect.storyIds),
      };
    case "moveStory":
      return {
        type: "moveSucceeded",
        requestId: effect.requestId,
        storyId: effect.storyId,
        story: await clients.shortcut.moveStory(effect.storyId, effect.stateId),
      };
  }
};

const failureMsg = (effect: Effect, message: string): Msg => {
  switch (effect.type) {
    case "loadWorkspace":
      return { type: "workspaceFailed", requestId: effect.requestId, message };
    case "searchStories":
      return { type: "searchFailed", requestId: effect.requestId, message };
    case "getStory":
      return {
        type: "detailFailed",
        requestId: effect.requestId,
        storyId: effect.storyId,
        message,
      };
    case "loadPullRequests":
      return { type: "pullRequestsFailed", requestId: effect.requestId, message };
    case "moveStory":
      return {
        type: "moveFailed",
        requestId: effect.requestId,
        storyId: effect.storyId,
        message,
      };
  }
};

export const runEffect = async (
  clients: Clients,
  effect: Effect,
  now: () => Date,
): Promise<Msg> => {
  try {
    return await runEffectUnsafe(clients, effect, now);
  } catch (error) {
    return failureMsg(effect, messageOf(error));
  }
};
