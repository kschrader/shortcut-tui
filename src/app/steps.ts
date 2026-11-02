import { expect } from "bun:test";
import type { StorySummary } from "../shortcut/types.ts";
import { workspaceFor } from "./fixtures.ts";
import type { Effect, Model, Msg } from "./model.ts";
import { init, update } from "./update.ts";

export type EffectOf<K extends Effect["type"]> = Extract<Effect, { type: K }>;

export const ofType = <K extends Effect["type"]>(effects: Effect[], type: K): EffectOf<K>[] =>
  effects.filter((effect): effect is EffectOf<K> => effect.type === type);

export const first = <K extends Effect["type"]>(effects: Effect[], type: K): EffectOf<K> => {
  const [effect] = ofType(effects, type);
  if (effect === undefined) throw new Error(`expected a ${type} effect`);
  return effect;
};

export const only = <K extends Effect["type"]>(effects: Effect[], type: K): EffectOf<K> => {
  expect(effects.map((effect) => effect.type)).toEqual([type]);
  return first(effects, type);
};

export const loggedIn = (): [Model, EffectOf<"searchStories">] => {
  const [initial, initEffects] = init();
  const load = only(initEffects, "loadWorkspace");
  const [model, effects] = update(initial, {
    type: "workspaceLoaded",
    requestId: load.requestId,
    workspace: workspaceFor("kurt"),
  });
  return [model, only(effects, "searchStories")];
};

export const answer = (
  model: Model,
  search: EffectOf<"searchStories">,
  stories: readonly StorySummary[],
): [Model, Effect[]] =>
  update(model, { type: "searchSucceeded", requestId: search.requestId, stories });

export const browsing = (stories: readonly StorySummary[]): [Model, Effect[]] => {
  const [model, search] = loggedIn();
  return answer(model, search, stories);
};

export const submitQuery = (model: Model, draft: string): [Model, Effect[]] => {
  const msgs: Msg[] = [
    { type: "queryEditStarted" },
    { type: "queryDraftChanged", draft },
    { type: "querySubmitted" },
  ];
  let current = model;
  const effects: Effect[] = [];
  for (const msg of msgs) {
    const [next, emitted] = update(current, msg);
    current = next;
    effects.push(...emitted);
  }
  return [current, effects];
};
