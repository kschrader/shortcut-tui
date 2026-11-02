type Effect = { type: "load" } | { type: "search"; query: string } | { type: "get"; id: number };

export const describe = (effect: Effect): string => {
  if (effect.type === "load") {
    return "load";
  }
  if (effect.type === "search") {
    return effect.query;
  }
  return `get ${effect.id}`;
};
