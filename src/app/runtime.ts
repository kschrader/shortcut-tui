import { useEffect, useState, useSyncExternalStore } from "react";
import type { Clients } from "./effects.ts";
import type { Model, Msg } from "./model.ts";
import { createStoryStore } from "./store.ts";

export type StoryBrowser = { model: Model; dispatch: (msg: Msg) => void };

export const useStoryBrowser = (clients: Clients): StoryBrowser => {
  const [store] = useState(() => createStoryStore(clients));
  const model = useSyncExternalStore(store.subscribe, store.getModel);
  useEffect(() => store.start(), [store]);
  return { model, dispatch: store.dispatch };
};
