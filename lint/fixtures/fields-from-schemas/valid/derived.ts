import { ShortcutV4Client } from "@shortcut/client/v4";
import { z } from "zod";

const fieldsOf = (shape: Record<string, unknown>): string => Object.keys(shape).join(",");
const storyFields = { id: z.number(), name: z.string() };
export const STORY_FIELDS = fieldsOf(storyFields);
const Story = z.object(storyFields);

export const storyName = async (token: string, id: number): Promise<string> => {
  const workspace = new ShortcutV4Client({ token }).workspace("acme");
  const { entity } = await workspace.getStory(id, { fields: STORY_FIELDS });
  return Story.parse(entity).name;
};
