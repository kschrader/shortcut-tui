import type { AutoRefresh } from "./auto-refresh.ts";
import type { Clock } from "./clock.ts";
import { runEffect, type Clients } from "./effects.ts";
import type { Effect, Model, Msg, StartupList } from "./model.ts";
import { init, update } from "./update.ts";

export type StoryStore = {
  getModel: () => Model;
  subscribe: (listener: () => void) => () => void;
  dispatch: (msg: Msg) => void;
  start: () => () => void;
};

export type StartupCache = {
  list: StartupList | null;
  save: (list: StartupList) => Promise<void>;
};

export const noStartupCache: StartupCache = { list: null, save: () => Promise.resolve() };

export type StoreOptions = { clock: Clock; autoRefresh: AutoRefresh; startupCache: StartupCache };

export const createStoryStore = (
  clients: Clients,
  { clock, autoRefresh, startupCache }: StoreOptions,
): StoryStore => {
  const [initialModel, initialEffects] = init(startupCache.list);
  let model = initialModel;
  let alive = true;
  let stopAutoRefresh: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const restartAutoRefresh = () => {
    if (autoRefresh.mode === "off") return;
    stopAutoRefresh?.();
    stopAutoRefresh = clock.every(autoRefresh.ms, () => dispatch({ type: "autoRefreshDue" }));
  };

  const run = (effects: readonly Effect[]) => {
    if (stopAutoRefresh !== null && effects.some((effect) => effect.type === "searchStories")) {
      restartAutoRefresh();
    }
    for (const effect of effects) {
      switch (effect.type) {
        case "saveStartupList":
          void startupCache.save(effect.list);
          break;
        case "loadWorkspace":
        case "searchStories":
        case "getStory":
        case "loadPullRequests":
        case "moveStory":
          void runEffect(clients, effect, clock.now).then((msg) =>
            alive ? dispatch(msg) : undefined,
          );
      }
    }
  };

  const dispatch = (msg: Msg) => {
    const [next, effects] = update(model, msg);
    model = next;
    for (const listener of listeners) listener();
    run(effects);
  };

  return {
    getModel: () => model,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch,
    start: () => {
      alive = true;
      restartAutoRefresh();
      run(initialEffects);
      return () => {
        alive = false;
        stopAutoRefresh?.();
        stopAutoRefresh = null;
      };
    },
  };
};
