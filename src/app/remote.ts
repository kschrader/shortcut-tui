import type { Effect, Reload, Remote, RemoteRequest, RequestId } from "./model.ts";

const isRequestId = (n: number): n is RequestId => Number.isSafeInteger(n) && n > 0;

const toRequestId = (n: number): RequestId => {
  if (!isRequestId(n)) throw new RangeError(`request id ${String(n)} is out of range`);
  return n;
};

export const requestIdAfter = (id: RequestId): RequestId => toRequestId(id + 1);

export const firstRequestId = toRequestId(1);

export const idle: Reload = { status: "idle" };

export const firstLoad = <T>(requestId: RequestId): Remote<T> => ({
  status: "firstLoad",
  requestId,
});

export const loaded = <T>(value: T): Remote<T> => ({ status: "loaded", value, reload: idle });

export const inFlight = (reload: Reload): RequestId | null => {
  switch (reload.status) {
    case "inFlight":
      return reload.requestId;
    case "idle":
    case "failed":
      return null;
  }
};

export const awaited = <T>(remote: Remote<T> | undefined): RequestId | null => {
  switch (remote?.status) {
    case "firstLoad":
      return remote.requestId;
    case "loaded":
      return inFlight(remote.reload);
    case "failed":
    case undefined:
      return null;
  }
};

export const isAwaiting = <T>(remote: Remote<T> | undefined, requestId: RequestId): boolean =>
  awaited(remote) === requestId;

export const refetch = <T>(remote: Remote<T> | undefined, requestId: RequestId): Remote<T> => {
  switch (remote?.status) {
    case "loaded":
      return { ...remote, reload: { status: "inFlight", requestId } };
    case "firstLoad":
    case "failed":
    case undefined:
      return firstLoad(requestId);
  }
};

export const fail = <T>(remote: Remote<T>, message: string): Remote<T> => {
  switch (remote.status) {
    case "loaded":
      return { ...remote, reload: { status: "failed", message } };
    case "firstLoad":
    case "failed":
      return { status: "failed", message };
  }
};

export const reloadFailure = <T>(remote: Remote<T> | undefined): string | null =>
  remote?.status === "loaded" && remote.reload.status === "failed" ? remote.reload.message : null;

export const requestsIn = (effects: readonly Effect[]): RemoteRequest[] =>
  effects.flatMap((effect) => {
    switch (effect.type) {
      case "saveStartupList":
        return [];
      case "loadWorkspace":
      case "searchStories":
      case "getStory":
      case "loadPullRequests":
      case "moveStory":
        return [effect];
    }
  });
