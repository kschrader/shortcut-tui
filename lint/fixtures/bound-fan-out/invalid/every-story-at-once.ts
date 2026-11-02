type StoryId = number;
type Shortcut = { listPullRequests: (id: StoryId) => Promise<readonly string[]> };

export const pullRequestsOf = async (shortcut: Shortcut, storyIds: readonly StoryId[]) =>
  new Map(
    await Promise.all(
      storyIds.map(async (id): Promise<[StoryId, readonly string[]]> => [
        id,
        await shortcut.listPullRequests(id),
      ]),
    ),
  );
