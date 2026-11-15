import { ShortcutV4Client } from "@shortcut/client/v4";

export const storyName = async (token: string, id: number): Promise<string> => {
  const workspace = new ShortcutV4Client({ token }).workspace("acme");
  const { entity } = await workspace.getStory(id, { fields: "name" });
  return entity.name ?? "";
};
