type Client = { getStory: (id: number) => Promise<{ name: string }> };

export const storyName = async (client: Client, id: number): Promise<string> => {
  const story = await client.getStory(id);
  return story.name;
};
