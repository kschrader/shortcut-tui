import type { PullRequestState } from "../github/types.ts";
import type { StoryId, StorySummary, WorkflowState, WorkflowStateId } from "../shortcut/types.ts";
import { toDo, workflowStates } from "./fixtures.ts";
import type { Effect, Model, Msg, Question, RemoteRequest, RequestId } from "./model.ts";
import { pickerStates, verdictOnRead } from "./moves.ts";

export const stateById = (id: WorkflowStateId): WorkflowState => {
  const state = workflowStates.find((candidate) => candidate.id === id);
  if (state === undefined) throw new Error(`no fixture state ${String(id)}`);
  return state;
};

type ServerStates = ReadonlyMap<StoryId, WorkflowState>;

export type MoveEffect = Extract<Effect, { type: "moveStory" }>;

export type MoveAnswer =
  | { kind: "refused" }
  | { kind: "moved"; state: WorkflowState }
  | { kind: "conflict"; found: WorkflowState };

export type World = {
  canWrite: boolean;
  server: Map<StoryId, WorkflowState>;
  snapshots: Map<RequestId, ServerStates>;
  delivered: Set<RequestId>;
  moveReads: Map<RequestId, WorkflowState>;
  moveAnswers: Map<RequestId, MoveAnswer>;
  teammates: boolean;
  teammateMoved: Set<StoryId>;
  unseenTeammateMoveAt: Map<StoryId, number>;
  searchSentAt: Map<RequestId, number>;
  clock: number;
  unreadOverwrites: string[];
  intents: Map<StoryId, WorkflowStateId>;
  applied: Map<string, RequestId>;
};

export const newWorld = (canWrite: boolean, teammates: boolean): World => ({
  canWrite,
  teammates,
  server: new Map(),
  snapshots: new Map(),
  delivered: new Set(),
  moveReads: new Map(),
  moveAnswers: new Map(),
  teammateMoved: new Set(),
  unseenTeammateMoveAt: new Map(),
  searchSentAt: new Map(),
  clock: 0,
  unreadOverwrites: [],
  intents: new Map(),
  applied: new Map(),
});

export const serverState = (states: ServerStates, id: StoryId): WorkflowState =>
  states.get(id) ?? toDo;

export const teammateMoves = (world: World, storyId: StoryId, state: WorkflowState): void => {
  if (serverState(world.server, storyId).id === state.id) return;
  world.server.set(storyId, state);
  world.teammateMoved.add(storyId);
  world.clock += 1;
  world.unseenTeammateMoveAt.set(storyId, world.clock);
};

export const searchSent = (world: World, requestId: RequestId): void => {
  world.clock += 1;
  world.snapshots.set(requestId, new Map(world.server));
  world.searchSentAt.set(requestId, world.clock);
};

export const searchApplied = (world: World, model: Model, requestId: RequestId): void => {
  const sentAt = world.searchSentAt.get(requestId) ?? 0;
  for (const [storyId, movedAt] of world.unseenTeammateMoveAt) {
    if (sentAt > movedAt && !model.moves.has(storyId)) world.unseenTeammateMoveAt.delete(storyId);
  }
};

export const shortcutReads = (world: World, effect: MoveEffect): WorkflowState => {
  const read = world.moveReads.get(effect.requestId) ?? serverState(world.server, effect.storyId);
  world.moveReads.set(effect.requestId, read);
  return read;
};

const shortcutAnswers = (world: World, effect: MoveEffect, succeed: boolean): MoveAnswer => {
  if (!succeed) return { kind: "refused" };
  const read = shortcutReads(world, effect);
  switch (verdictOnRead(read.id, effect)) {
    case "alreadyThere":
      return { kind: "moved", state: read };
    case "conflict":
      return { kind: "conflict", found: read };
    case "write": {
      const replaced = serverState(world.server, effect.storyId);
      const overAMove = replaced.id !== effect.knownStateId && replaced.id !== effect.stateId;
      if (overAMove && read.id !== effect.knownStateId) {
        world.unreadOverwrites.push(
          `move ${String(effect.requestId)} read ${read.name}, not the state the app believed, and wrote over ${replaced.name}`,
        );
      }
      const state = stateById(effect.stateId);
      world.server.set(effect.storyId, state);
      return { kind: "moved", state };
    }
  }
};

export const answerMove = (world: World, effect: MoveEffect, succeed: boolean): MoveAnswer => {
  const answer = world.moveAnswers.get(effect.requestId) ?? shortcutAnswers(world, effect, succeed);
  world.moveAnswers.set(effect.requestId, answer);
  return answer;
};

export const searchedStories = (model: Model) =>
  model.results.status === "loaded" ? model.results.value.stories : [];

const finishedWork = (states: readonly PullRequestState[]) =>
  states.includes("merged") && states.every((state) => state === "merged" || state === "closed");

const nextDay = (day: string): Date => {
  const [year = 0, month = 1, date = 0] = day.split("-").map(Number);
  return new Date(year, month - 1, date + 1);
};

const searchStillAsksFor = (model: Model, question: Question, story: StorySummary): boolean => {
  const floor = question.movedOnOrBefore;
  if (floor !== null && story.movedAt.getTime() >= nextDay(floor).getTime()) return false;
  const started = story.state.progress === "started";
  const { view } = question;
  switch (view.kind) {
    case "query":
      return (
        model.workspace.status !== "loaded" ||
        view.text !== `owner:${model.workspace.value.me.mentionName} is:started !is:archived` ||
        started
      );
    case "inReview":
      return story.state.name.toLowerCase().includes("review");
    case "mergedNotMoved":
      return started;
  }
};

export const listedStories = (model: Model) => {
  if (model.results.status !== "loaded") return [];
  const { question } = model.results.value;
  const stories = searchedStories(model).filter(
    (story) =>
      model.moves.get(story.id)?.status !== "moved" || searchStillAsksFor(model, question, story),
  );
  if (question.view.kind !== "mergedNotMoved") return stories;
  return stories.filter((story) => {
    const list = model.pullRequests.value.get(story.id);
    return list?.status === "loaded" && finishedWork(list.value.map((pr) => pr.state));
  });
};

export const moveViolations = (
  model: Model,
  issued: readonly RemoteRequest[],
  world: World,
): string[] => {
  const found: string[] = [...world.unreadOverwrites];
  for (const effect of issued) {
    if (effect.type !== "moveStory") continue;
    const conflicted = world.moveAnswers.get(effect.requestId)?.kind === "conflict";
    if (conflicted && !world.teammateMoved.has(effect.storyId)) {
      found.push(`move ${String(effect.requestId)} conflicted though nobody else moved its story`);
    }
  }
  const unanswered = issued.filter(
    (effect) => effect.type === "moveStory" && !world.delivered.has(effect.requestId),
  );
  for (const story of searchedStories(model)) {
    const inFlight = unanswered.filter(
      (effect) => effect.type === "moveStory" && effect.storyId === story.id,
    );
    if (inFlight.length > 1) {
      found.push(`${String(inFlight.length)} moves in flight for story ${String(story.id)}`);
    }
    if (inFlight.length === 1) {
      const intent = world.intents.get(story.id);
      if (story.state.id !== intent) {
        found.push(
          `story ${String(story.id)} shows ${story.state.name} while its move to state ${String(intent)} is in flight`,
        );
      }
    } else {
      const server = serverState(world.server, story.id);
      if (story.state.id !== server.id && !world.unseenTeammateMoveAt.has(story.id)) {
        found.push(
          `story ${String(story.id)} shows ${story.state.name} but the server has ${server.name}`,
        );
      }
    }
  }
  for (const [storyId, move] of model.moves) {
    if (move.status !== "saving") continue;
    const effect = issued.find((candidate) => candidate.requestId === move.requestId);
    if (effect?.type !== "moveStory" || effect.storyId !== storyId) {
      found.push(`story ${String(storyId)} is saving a request that was never sent for it`);
    } else if (world.delivered.has(move.requestId)) {
      found.push(`story ${String(storyId)} is still saving an answered request`);
    }
  }
  for (const effect of unanswered) {
    if (effect.type !== "moveStory") continue;
    const move = model.moves.get(effect.storyId);
    if (move?.status !== "saving" || move.requestId !== effect.requestId) {
      found.push(`move ${String(effect.requestId)} is in flight but its story is not saving`);
    }
  }
  const { focus } = model;
  if (focus.mode === "picking") {
    if (!listedStories(model).some((story) => story.id === focus.storyId)) {
      found.push("the picker is open on a story that is not shown");
    }
    if (model.workspace.status === "loaded" && !model.workspace.value.canWrite) {
      found.push("the picker is open with a read-only token");
    }
  }
  return found;
};

export const conflictViolations = (
  before: Model,
  after: Model,
  msg: Msg,
  effects: readonly Effect[],
): string[] => {
  if (msg.type !== "moveConflicted") return [];
  const found: string[] = effects.length > 0 ? ["a conflict sent a request"] : [];
  const was = before.moves.get(msg.storyId);
  if (was?.status !== "saving" || was.requestId !== msg.requestId) return found;
  if (after.moves.get(msg.storyId)?.status !== "failed") found.push("a conflict did not fail");
  const shown = searchedStories(after).find((story) => story.id === msg.storyId);
  if (shown !== undefined && shown.state.id !== msg.story.state.id) {
    found.push(`a conflict that read ${msg.story.state.name} shows ${shown.state.name}`);
  }
  return found;
};

export const pickedTarget = (model: Model): [StoryId, WorkflowStateId] | null => {
  const { focus } = model;
  if (focus.mode !== "picking" || model.workspace.status !== "loaded") return null;
  const story = listedStories(model).find((candidate) => candidate.id === focus.storyId);
  if (story === undefined) return null;
  const target = pickerStates(model.workspace.value, story)[focus.cursor];
  return target === undefined ? null : [story.id, target.id];
};
