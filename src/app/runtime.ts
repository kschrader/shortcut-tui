import { useEffect, useState, useSyncExternalStore } from "react";
import type { Clients } from "./effects.ts";
import type { Model, Msg } from "./model.ts";
import { createStoryStore, type StoreOptions } from "./store.ts";

export type StoryBrowser = { model: Model; dispatch: (msg: Msg) => void; now: Date };

const RENDER_TICK_MS = 60_000;

export const useStoryBrowser = (clients: Clients, options: StoreOptions): StoryBrowser => {
  const [store] = useState(() => createStoryStore(clients, options));
  const model = useSyncExternalStore(store.subscribe, store.getModel);
  const { clock } = options;
  const [now, setNow] = useState(clock.now);
  useEffect(() => store.start(), [store]);
  useEffect(() => clock.every(RENDER_TICK_MS, () => setNow(clock.now())), [clock]);
  return { model, dispatch: store.dispatch, now };
};
