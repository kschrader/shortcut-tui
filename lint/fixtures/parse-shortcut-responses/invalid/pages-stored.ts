import { ShortcutV4Client } from "@shortcut/client/v4";

export const storyPages = (token: string, query: string) => {
  const client = new ShortcutV4Client({ token });
  return client.paginate(client.workspace("acme").searchStories({ query, limit: 100 }));
};
