import type { ShortcutClient } from "../shortcut/types.ts";
import type { Effect, Msg } from "./model.ts";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runEffectUnsafe = async (client: ShortcutClient, effect: Effect): Promise<Msg> => {
  switch (effect.type) {
    case "loadWorkspace":
      return {
        type: "workspaceLoaded",
        requestId: effect.requestId,
        workspace: await client.loadWorkspace(),
      };
    case "searchStories":
      return {
        type: "searchSucceeded",
        requestId: effect.requestId,
        stories: await client.searchStories(effect.query),
      };
    case "getStory":
      return {
        type: "detailSucceeded",
        requestId: effect.requestId,
        story: await client.getStory(effect.storyId),
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
  }
};

export const runEffect = async (client: ShortcutClient, effect: Effect): Promise<Msg> => {
  try {
    return await runEffectUnsafe(client, effect);
  } catch (error) {
    return failureMsg(effect, messageOf(error));
  }
};
