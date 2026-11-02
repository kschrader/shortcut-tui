type Failure = { type: "missing" } | { type: "unreadable"; reason: string } | { type: "denied" };

export const head = (failure: Failure) =>
  failure.type === "missing" ? "none" : failure.type === "denied" ? "denied" : "bad";
