import { ShortcutV4Client } from "@shortcut/client/v4";

export const storyName = (token: string, id: number): Promise<string> =>
  new ShortcutV4Client({ token })
    .workspace("acme")
    .getStory(id)
    .then((response) => response.entity.name ?? "");
