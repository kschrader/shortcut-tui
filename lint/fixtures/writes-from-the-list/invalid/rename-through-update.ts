import { ShortcutV4Client } from "@shortcut/client/v4";

export const storyClient = (token: string) => {
  const api = new ShortcutV4Client({ token }).workspace("acme");
  return {
    renameStory: async (id: number, name: string) => {
      const { entity } = await api.updateStory(id, { name });
      return entity.id;
    },
  };
};
