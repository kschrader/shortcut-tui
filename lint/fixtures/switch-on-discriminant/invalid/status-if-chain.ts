type Remote<T> =
  | { status: "loading" }
  | { status: "loaded"; value: T }
  | { status: "failed"; message: string };

export const label = (remote: Remote<string>): string => {
  if (remote.status === "loading") return "…";
  if (remote.status === "failed") return remote.message;
  return remote.value;
};
