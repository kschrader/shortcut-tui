type Query = readonly number[];
type Ask = (query: Query) => Promise<readonly string[]>;

export const lookUp = async (ask: Ask, queries: readonly Query[]) => {
  const settled = await Promise.allSettled(queries.map((query) => ask(query)));
  return settled.flatMap((query) => (query.status === "fulfilled" ? query.value : []));
};
