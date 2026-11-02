import type { ShortcutClient } from "../shortcut/types.ts";
import type { Effect, Msg } from "./model.ts";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const runEffectUnsafe = async (client: ShortcutClient, effect: Effect): Promise<Msg> => {
  if (effect.type === "loadWorkspace") {
    const workspace = await client.loadWorkspace();
    return { type: "workspaceLoaded", requestId: effect.requestId, workspace };
  }
  if (effect.type === "searchStories") {
    const stories = await client.searchStories(effect.query);
    return { type: "searchSucceeded", requestId: effect.requestId, stories };
  }
  const story = await client.getStory(effect.storyId);
  return { type: "detailSucceeded", requestId: effect.requestId, story };
};

const failureMsg = (effect: Effect, message: string): Msg => {
  if (effect.type === "loadWorkspace") {
    return { type: "workspaceFailed", requestId: effect.requestId, message };
  }
  if (effect.type === "searchStories") {
    return { type: "searchFailed", requestId: effect.requestId, message };
  }
  return { type: "detailFailed", requestId: effect.requestId, storyId: effect.storyId, message };
};

export const runEffect = async (client: ShortcutClient, effect: Effect): Promise<Msg> => {
  try {
    return await runEffectUnsafe(client, effect);
  } catch (error) {
    return failureMsg(effect, messageOf(error));
  }
};
