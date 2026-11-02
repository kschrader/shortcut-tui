type Fake = { listPullRequests: (id: number) => Promise<readonly string[]> };

export const everyList = (fake: Fake, ids: readonly number[]) =>
  Promise.all(ids.map((id) => fake.listPullRequests(id)));
