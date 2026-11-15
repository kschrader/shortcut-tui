import { ShortcutV4Client } from "@shortcut/client/v4";

export const subTasks = (token: string, id: number) =>
  new ShortcutV4Client({ token })
    .workspace("acme")
    .listStorySubTaskStories(id, { fields: `id,name,${"sub_task_stories.workflow_state"}` });
