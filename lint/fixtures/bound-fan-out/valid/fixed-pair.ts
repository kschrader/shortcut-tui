type Api = {
  getStory: (id: number) => Promise<string>;
  listComments: (id: number) => Promise<readonly string[]>;
};

export const storyWithComments = async (api: Api, id: number) => {
  const [story, comments] = await Promise.all([api.getStory(id), api.listComments(id)]);
  return { story, comments };
};
