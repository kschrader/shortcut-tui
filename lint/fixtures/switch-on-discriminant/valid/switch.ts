type Effect = { type: "load" } | { type: "search"; query: string };

export const describe = (effect: Effect): string => {
  switch (effect.type) {
    case "load":
      return "load";
    case "search":
      return effect.query;
  }
};

export const isFeature = (story: { storyType: string }) => story.storyType === "feature";
