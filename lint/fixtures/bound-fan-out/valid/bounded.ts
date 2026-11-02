import { settleLimited } from "../../../../src/concurrency.ts";

type StoryId = number;
type Shortcut = { listPullRequests: (id: StoryId) => Promise<readonly string[]> };

export const pullRequestsOf = async (shortcut: Shortcut, storyIds: readonly StoryId[]) =>
  settleLimited(storyIds, 6, (id) => shortcut.listPullRequests(id));
