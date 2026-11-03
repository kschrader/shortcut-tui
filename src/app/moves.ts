import type {
  Progress,
  StoryId,
  StorySummary,
  WorkflowState,
  Workspace,
} from "../shortcut/types.ts";
import type { Model, RequestId, Step, StoryMove } from "./model.ts";
import { requestIdAfter } from "./remote.ts";

const progressRank: Record<Progress, number> = { unstarted: 0, started: 1, done: 2 };

const furthestAlongFirst = (a: StorySummary, b: StorySummary) =>
  progressRank[b.state.progress] - progressRank[a.state.progress] ||
  b.state.position - a.state.position ||
  a.state.workflow.name.localeCompare(b.state.workflow.name) ||
  a.state.id - b.state.id ||
  b.updatedAt.getTime() - a.updatedAt.getTime();

export const pickerStates = (workspace: Workspace, story: StorySummary): readonly WorkflowState[] =>
  workspace.workflowStates
    .filter((state) => state.workflow.id === story.state.workflow.id)
    .toSorted((a, b) => a.position - b.position || a.id - b.id);

const intentOf = (move: StoryMove): WorkflowState => {
  switch (move.status) {
    case "saving":
      return move.pending ?? move.target;
    case "moved":
    case "failed":
      return move.known;
  }
};

export const restate = (
  model: Model,
  storyId: StoryId,
  state: WorkflowState,
  replacement?: StorySummary,
): Model => {
  if (model.results.status !== "loaded") return model;
  const stories = model.results.value.stories
    .map((story) => (story.id === storyId ? { ...(replacement ?? story), state } : story))
    .toSorted(furthestAlongFirst);
  return { ...model, results: { ...model.results, value: { ...model.results.value, stories } } };
};

export const startMove = (
  model: Model,
  storyId: StoryId,
  target: WorkflowState,
  known: WorkflowState,
  trustFrom: RequestId,
): Step => {
  const requestId = model.nextRequestId;
  return [
    {
      ...restate(model, storyId, target),
      moves: new Map(model.moves).set(storyId, {
        status: "saving",
        requestId,
        target,
        pending: null,
        known,
        trustFrom,
      }),
      nextRequestId: requestIdAfter(requestId),
    },
    [{ type: "moveStory", requestId, storyId, stateId: target.id }],
  ];
};

export const carryMoves = (
  model: Model,
  requestId: RequestId,
  found: readonly StorySummary[],
): { stories: readonly StorySummary[]; moves: Model["moves"] } => {
  const stories = found
    .map((story) => {
      const move = model.moves.get(story.id);
      if (move === undefined) return story;
      switch (move.status) {
        case "saving":
          return { ...story, state: intentOf(move) };
        case "moved":
        case "failed":
          return requestId >= move.trustFrom ? story : { ...story, state: move.known };
      }
    })
    .toSorted(furthestAlongFirst);
  const moves = new Map(model.moves);
  for (const [storyId, move] of model.moves) {
    if (requestId < move.trustFrom) continue;
    const fresh = found.find((story) => story.id === storyId);
    switch (move.status) {
      case "saving":
        if (fresh !== undefined) moves.set(storyId, { ...move, known: fresh.state });
        break;
      case "moved":
      case "failed":
        moves.delete(storyId);
        break;
    }
  }
  return { stories, moves };
};
