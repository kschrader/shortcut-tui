import { ShortcutV4Client } from "@shortcut/client/v4";

export const storyEntity = async (token: string, id: number) => {
  const workspace = new ShortcutV4Client({ token }).workspace("acme");
  const response = await workspace.getStory(id, { fields: "id,name,workflow_state" });
  return response;
};
