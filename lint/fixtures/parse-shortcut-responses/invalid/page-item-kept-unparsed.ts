import { ShortcutV4Client } from "@shortcut/client/v4";

export const stories = async (token: string, query: string) => {
  const client = new ShortcutV4Client({ token });
  const workspace = client.workspace("acme");
  const found = [];
  for await (const raw of client.paginate(workspace.searchStories({ query, limit: 100 }))) {
    found.push(raw);
  }
  return found;
};
