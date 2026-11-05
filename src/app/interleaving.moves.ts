import type { PullRequestState } from "../github/types.ts";
import type { StoryId, WorkflowState, WorkflowStateId } from "../shortcut/types.ts";
import { toDo, workflowStates } from "./fixtures.ts";
import type { Effect, Model, RequestId } from "./model.ts";
import { pickerStates } from "./moves.ts";

export const stateById = (id: WorkflowStateId): WorkflowState => {
  const state = workflowStates.find((candidate) => candidate.id === id);
  if (state === undefined) throw new Error(`no fixture state ${String(id)}`);
  return state;
};

type ServerStates = ReadonlyMap<StoryId, WorkflowState>;

export type World = {
  canWrite: boolean;
  server: Map<StoryId, WorkflowState>;
  snapshots: Map<RequestId, ServerStates>;
  delivered: Set<RequestId>;
  moveOutcomes: Map<RequestId, boolean>;
  intents: Map<StoryId, WorkflowStateId>;
  applied: Map<string, RequestId>;
};

export const serverState = (states: ServerStates, id: StoryId): WorkflowState =>
  states.get(id) ?? toDo;

export const searchedStories = (model: Model) =>
  model.results.status === "loaded" ? model.results.value.stories : [];

const finishedWork = (states: readonly PullRequestState[]) =>
  states.includes("merged") && states.every((state) => state === "merged" || state === "closed");

export const listedStories = (model: Model) => {
  const stories = searchedStories(model);
  if (model.results.status !== "loaded") return stories;
  if (model.results.value.question.view.kind !== "mergedNotMoved") return stories;
  return stories.filter((story) => {
    const list = model.pullRequests.value.get(story.id);
    return list?.status === "loaded" && finishedWork(list.value.map((pr) => pr.state));
  });
};

export const moveViolations = (model: Model, issued: readonly Effect[], world: World): string[] => {
  const found: string[] = [];
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
      if (story.state.id !== server.id) {
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

export const pickedTarget = (model: Model): [StoryId, WorkflowStateId] | null => {
  const { focus } = model;
  if (focus.mode !== "picking" || model.workspace.status !== "loaded") return null;
  const story = listedStories(model).find((candidate) => candidate.id === focus.storyId);
  if (story === undefined) return null;
  const target = pickerStates(model.workspace.value, story)[focus.cursor];
  return target === undefined ? null : [story.id, target.id];
};
