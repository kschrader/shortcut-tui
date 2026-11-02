import { useEffect, useState, useSyncExternalStore } from "react";
import type { ShortcutClient } from "../shortcut/types.ts";
import type { Model, Msg } from "./model.ts";
import { createStoryStore } from "./store.ts";

export type StoryBrowser = { model: Model; dispatch: (msg: Msg) => void };

export const useStoryBrowser = (client: ShortcutClient): StoryBrowser => {
  const [store] = useState(() => createStoryStore(client));
  const model = useSyncExternalStore(store.subscribe, store.getModel);
  useEffect(() => store.start(), [store]);
  return { model, dispatch: store.dispatch };
};
