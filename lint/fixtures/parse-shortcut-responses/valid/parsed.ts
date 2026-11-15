import { ShortcutV4Client } from "@shortcut/client/v4";
import { z } from "zod";

const Whoami = z.object({ entity: z.object({ workspace: z.object({ slug: z.string() }) }) });
const Story = z.object({ id: z.number(), name: z.string() });

export const storyNames = async (token: string, query: string) => {
  const client = new ShortcutV4Client({ token });
  const whoami = Whoami.parse(await client.getWhoami());
  const workspace = client.workspace(whoami.entity.workspace.slug);
  const names: string[] = [];
  for await (const raw of client.paginate(
    workspace.searchStories({ query, limit: 100, fields: "id,name" }),
  )) {
    names.push(Story.parse(raw).name);
  }
  const { entity } = await workspace.getStory(1, { fields: "id,name" });
  const first = Story.safeParse(entity);
  return first.success ? [first.data.name, ...names] : names;
};
