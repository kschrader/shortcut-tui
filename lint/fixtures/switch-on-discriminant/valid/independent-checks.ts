type Remote = { status: "loading"; id: number } | { status: "loaded"; value: string };

export const problems = (remote: Remote, expectedId: number): string[] => {
  const found: string[] = [];
  if (remote.status === "loading" && remote.id !== expectedId) found.push("wrong request");
  if (remote.status === "loaded" && remote.value === "") found.push("empty value");
  return found;
};
