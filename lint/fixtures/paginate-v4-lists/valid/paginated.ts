import { ShortcutV4Client } from "@shortcut/client/v4";

export const openStoryNames = async (token: string, query: string): Promise<string[]> => {
  const client = new ShortcutV4Client({ token });
  const workspace = client.workspace("acme");
  const names: string[] = [];
  for await (const story of client.paginate(
    workspace.searchStories({ query, limit: 100, fields: "name" }),
  )) {
    names.push(story.name ?? "");
  }
  return names;
};
