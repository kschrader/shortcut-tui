import { ShortcutV4Client } from "@shortcut/client/v4";

export const storyClient = (token: string) => {
  const api = new ShortcutV4Client({ token }).workspace("acme");
  return {
    commentOnStory: async (id: number, text: string) => {
      const { entity } = await api.createStoryComment(id, { text });
      return entity.id;
    },
  };
};
