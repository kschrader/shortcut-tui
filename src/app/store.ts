import type { ShortcutClient } from "../shortcut/types.ts";
import { runEffect } from "./effects.ts";
import type { Effect, Model, Msg } from "./model.ts";
import { init, update } from "./update.ts";

export type StoryStore = {
  getModel: () => Model;
  subscribe: (listener: () => void) => () => void;
  dispatch: (msg: Msg) => void;
  start: () => () => void;
};

export const createStoryStore = (client: ShortcutClient): StoryStore => {
  const [initialModel, initialEffects] = init();
  let model = initialModel;
  let alive = true;
  const listeners = new Set<() => void>();

  const run = (effects: readonly Effect[]) => {
    for (const effect of effects) {
      void runEffect(client, effect).then((msg) => (alive ? dispatch(msg) : undefined));
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
      run(initialEffects);
      return () => {
        alive = false;
      };
    },
  };
};
