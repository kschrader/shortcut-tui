import { ShortcutV4Client } from "@shortcut/client/v4";

export const commentCount = async (token: string, storyId: number): Promise<number> => {
  const workspace = new ShortcutV4Client({ token }).workspace("acme");
  const { entities } = await workspace.listStoryComments(storyId, { fields: "id" });
  return entities.length;
};
