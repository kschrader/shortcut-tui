import { expect } from "bun:test";
import type { StorySummary } from "../shortcut/types.ts";
import { storyId, workspaceFor } from "./fixtures.ts";
import type { Effect, Model, Msg, RemoteRequest } from "./model.ts";
import { pickerStates } from "./moves.ts";
import { requestsIn } from "./remote.ts";
import { init, update } from "./update.ts";

export const myStartedQuery = "owner:kurt is:started !is:archived";

export type EffectOf<K extends Effect["type"]> = Extract<Effect, { type: K }>;

export const ofType = <K extends Effect["type"]>(effects: Effect[], type: K): EffectOf<K>[] =>
  effects.filter((effect): effect is EffectOf<K> => effect.type === type);

export const first = <K extends Effect["type"]>(effects: Effect[], type: K): EffectOf<K> => {
  const [effect] = ofType(effects, type);
  if (effect === undefined) throw new Error(`expected a ${type} effect`);
  return effect;
};

export const only = <K extends RemoteRequest["type"]>(effects: Effect[], type: K): EffectOf<K> => {
  expect(requestsIn(effects).map((effect) => effect.type)).toEqual([type]);
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
  loadedAt = new Date("2026-11-02T09:00:00Z"),
): [Model, Effect[]] =>
  update(model, { type: "searchSucceeded", requestId: search.requestId, stories, loadedAt });

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

export const shown = (model: Model): readonly StorySummary[] => {
  if (model.results.status !== "loaded") throw new Error("results not loaded");
  return model.results.value.stories;
};

export const stateOf = (model: Model, id: number): string | undefined =>
  shown(model).find((story) => story.id === storyId(id))?.state.name;

export const pick = (model: Model, stateName: string): [Model, Effect[]] => {
  const [open, openEffects] = update(model, { type: "movePickerOpened" });
  expect(openEffects).toEqual([]);
  const { focus } = open;
  if (focus.mode !== "picking" || open.workspace.status !== "loaded") {
    throw new Error(`picker did not open (focus ${focus.mode})`);
  }
  const story = shown(open).find((candidate) => candidate.id === focus.storyId);
  if (story === undefined) throw new Error("picker story is not shown");
  const index = pickerStates(open.workspace.value, story).findIndex(
    (state) => state.name === stateName,
  );
  const [moved] = update(open, { type: "movePickerMoved", delta: index - focus.cursor });
  return update(moved, { type: "movePickerConfirmed" });
};
