import { ShortcutV4Client } from "@shortcut/client/v4";

export const storyClient = (token: string) => {
  const api = new ShortcutV4Client({ token }).workspace("acme");
  return {
    moveStory: async (id: number, stateId: number) => {
      const { entity } = await api.updateStory(id, { workflow_state_id: stateId });
      return entity.id;
    },
    storyName: async (id: number) => (await api.getStory(id, { fields: "name" })).entity.name,
  };
};
