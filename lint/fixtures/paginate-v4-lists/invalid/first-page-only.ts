import { ShortcutV4Client } from "@shortcut/client/v4";

export const openStoryNames = async (token: string, query: string): Promise<string[]> => {
  const workspace = new ShortcutV4Client({ token }).workspace("acme");
  const page = await workspace.searchStories({ query, limit: 25, fields: "name" });
  return page.entities.map((story) => story.name ?? "");
};
