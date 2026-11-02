import { pullRequestKey, type GitHubClient } from "../github/types.ts";
import type { LinkedPullRequest, ShortcutClient, StoryId } from "../shortcut/types.ts";
import type { Effect, Msg, StoryPullRequests } from "./model.ts";

export type Clients = { shortcut: ShortcutClient; github: GitHubClient };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const pullRequestsOf = async (
  { shortcut, github }: Clients,
  storyIds: readonly StoryId[],
): Promise<StoryPullRequests> => {
  const linked = await Promise.all(
    storyIds.map(async (id): Promise<[StoryId, readonly LinkedPullRequest[]]> => [
      id,
      await shortcut.listPullRequests(id),
    ]),
  );
  const states = await github.pullRequestStates(
    linked.flatMap(([, pullRequests]) => pullRequests.flatMap((pr) => pr.github ?? [])),
  );
  return new Map(
    linked.map(([id, pullRequests]) => [
      id,
      pullRequests.map((pr) => ({
        ...pr,
        state:
          pr.github === null ? "unknown" : (states.get(pullRequestKey(pr.github)) ?? "unknown"),
      })),
    ]),
  );
};

const runEffectUnsafe = async (clients: Clients, effect: Effect): Promise<Msg> => {
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
        stories: await clients.shortcut.searchStories(effect.query),
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

export const runEffect = async (clients: Clients, effect: Effect): Promise<Msg> => {
  try {
    return await runEffectUnsafe(clients, effect);
  } catch (error) {
    return failureMsg(effect, messageOf(error));
  }
};
