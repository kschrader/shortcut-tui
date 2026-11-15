import { ShortcutV4Client } from "@shortcut/client/v4";

export const story = async (token: string, id: number) =>
  (await new ShortcutV4Client({ token }).workspace("acme").getStory(id)).entity;
