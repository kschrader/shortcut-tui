export const settleLimited = async <T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> => {
  const settled: PromiseSettledResult<R>[] = [];
  const queue = items.entries();
  const work = async () => {
    for (const [index, item] of queue) {
      try {
        settled[index] = { status: "fulfilled", value: await task(item) };
      } catch (reason) {
        settled[index] = { status: "rejected", reason };
      }
    }
  };
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(limit, items.length); i += 1) workers.push(work());
  await Promise.all(workers);
  return settled;
};
