import { ShortcutV4Client } from "@shortcut/client/v4";

export const storyClient = (token: string) => {
  const api = new ShortcutV4Client({ token }).workspace("acme");
  return {
    moveStory: async (id: number, stateId: number) => {
      await api.updateStory(id, { workflow_state_id: stateId });
      const { entity } = await api.createStory({ name: "Follow up", workflow_state_id: stateId });
      return entity.id;
    },
  };
};
