type Client = { searchStories: (query: string) => Promise<readonly string[]> };

export const firstStory = async (client: Client): Promise<string | undefined> => {
  const stories = await client.searchStories("owner:me");
  return stories[0];
};
