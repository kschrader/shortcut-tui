import type {
  StoryId,
  StorySummary,
  WorkflowState,
  WorkflowStateId,
  Workspace,
} from "../shortcut/types.ts";
import type { Model, RequestId, Step, StoryMove } from "./model.ts";
import { groupingOf } from "./filters.ts";
import { orderFor } from "./order.ts";
import { firstRequestId, requestIdAfter } from "./remote.ts";

export const pickerStates = (workspace: Workspace, story: StorySummary): readonly WorkflowState[] =>
  workspace.workflowStates
    .filter((state) => state.workflow.id === story.state.workflow.id)
    .toSorted((a, b) => a.position - b.position || a.id - b.id);

type Saving = Extract<StoryMove, { status: "saving" }>;

export type MoveEvent =
  | { type: "picked"; target: WorkflowState; shown: WorkflowState }
  | { type: "confirmed"; requestId: RequestId; state: WorkflowState; movedAt: Date }
  | { type: "conflicted"; requestId: RequestId; state: WorkflowState }
  | { type: "refused"; requestId: RequestId; message: string };

export type MoveStep =
  | { kind: "send"; move: Saving }
  | { kind: "hold"; move: StoryMove; shows: WorkflowState };

const send = (
  requestId: RequestId,
  target: WorkflowState,
  known: WorkflowState,
  trustFrom: RequestId,
): MoveStep => ({
  kind: "send",
  move: { status: "saving", requestId, target, pending: null, known, trustFrom },
});

const queuedAfter = (saving: Saving, known: WorkflowState): WorkflowState | null =>
  saving.pending === null || saving.pending.id === known.id ? null : saving.pending;

const picked = (
  move: StoryMove | undefined,
  target: WorkflowState,
  shown: WorkflowState,
  nextRequestId: RequestId,
): MoveStep | null => {
  if (target.id === shown.id) return null;
  switch (move?.status) {
    case undefined:
      return send(nextRequestId, target, shown, firstRequestId);
    case "saving":
      return { kind: "hold", move: { ...move, pending: target }, shows: target };
    case "moved":
    case "failed":
      return send(nextRequestId, target, move.known, move.trustFrom);
  }
};

const confirmed = (
  saving: Saving,
  known: WorkflowState,
  movedAt: Date,
  nextRequestId: RequestId,
): MoveStep => {
  const queued = queuedAfter(saving, known);
  if (queued !== null) return send(nextRequestId, queued, known, nextRequestId);
  return {
    kind: "hold",
    move: { status: "moved", known, trustFrom: nextRequestId, movedAt },
    shows: known,
  };
};

const refused = (saving: Saving, message: string, nextRequestId: RequestId): MoveStep => {
  const { known, trustFrom } = saving;
  const queued = queuedAfter(saving, known);
  if (queued !== null) return send(nextRequestId, queued, known, trustFrom);
  return { kind: "hold", move: { status: "failed", message, known, trustFrom }, shows: known };
};

const conflicted = (found: WorkflowState, nextRequestId: RequestId): MoveStep => ({
  kind: "hold",
  move: {
    status: "failed",
    message: `it was moved to ${found.name} first`,
    known: found,
    trustFrom: nextRequestId,
  },
  shows: found,
});

const awaiting = (move: StoryMove | undefined, requestId: RequestId): Saving | null =>
  move?.status === "saving" && move.requestId === requestId ? move : null;

export const nextMove = (
  move: StoryMove | undefined,
  event: MoveEvent,
  nextRequestId: RequestId,
): MoveStep | null => {
  switch (event.type) {
    case "picked":
      return picked(move, event.target, event.shown, nextRequestId);
    case "confirmed": {
      const saving = awaiting(move, event.requestId);
      return saving === null ? null : confirmed(saving, event.state, event.movedAt, nextRequestId);
    }
    case "conflicted":
      return awaiting(move, event.requestId) === null
        ? null
        : conflicted(event.state, nextRequestId);
    case "refused": {
      const saving = awaiting(move, event.requestId);
      return saving === null ? null : refused(saving, event.message, nextRequestId);
    }
  }
};

export type ReadVerdict = "write" | "alreadyThere" | "conflict";

export const verdictOnRead = (
  held: WorkflowStateId,
  move: { stateId: WorkflowStateId; knownStateId: WorkflowStateId },
): ReadVerdict => {
  if (held === move.stateId) return "alreadyThere";
  return held === move.knownStateId ? "write" : "conflict";
};

export const shownAfterRefresh = (
  move: StoryMove,
  requestId: RequestId,
  story: StorySummary,
): StorySummary => {
  switch (move.status) {
    case "saving":
      return { ...story, state: move.pending ?? move.target };
    case "moved":
      return requestId >= move.trustFrom
        ? story
        : { ...story, state: move.known, movedAt: move.movedAt };
    case "failed":
      return requestId >= move.trustFrom ? story : { ...story, state: move.known };
  }
};

export const moveAfterRefresh = (
  move: StoryMove,
  requestId: RequestId,
  seen: WorkflowState | undefined,
): StoryMove | null => {
  if (requestId < move.trustFrom) return move;
  switch (move.status) {
    case "saving":
      return seen === undefined ? move : { ...move, known: seen };
    case "moved":
    case "failed":
      return null;
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
    .toSorted(orderFor(groupingOf(model.question.view)));
  return { ...model, results: { ...model.results, value: { ...model.results.value, stories } } };
};

export const applyMove = (
  model: Model,
  storyId: StoryId,
  step: MoveStep,
  replacement?: StorySummary,
): Step => {
  const moves = new Map(model.moves).set(storyId, step.move);
  switch (step.kind) {
    case "hold":
      return [{ ...restate(model, storyId, step.shows, replacement), moves }, []];
    case "send": {
      const { requestId, target, known } = step.move;
      return [
        {
          ...restate(model, storyId, target, replacement),
          moves,
          nextRequestId: requestIdAfter(requestId),
        },
        [{ type: "moveStory", requestId, storyId, stateId: target.id, knownStateId: known.id }],
      ];
    }
  }
};

export const withSubTask = (details: Model["details"], story: StorySummary): Model["details"] => {
  const next = new Map(details);
  for (const [id, detail] of details) {
    if (detail.status !== "loaded") continue;
    const { subTasks } = detail.value;
    if (!subTasks.some((subTask) => subTask.id === story.id)) continue;
    const replaced = subTasks.map((subTask) => (subTask.id === story.id ? story : subTask));
    next.set(id, { ...detail, value: { ...detail.value, subTasks: replaced } });
  }
  return next;
};

export const carryMoves = (
  model: Model,
  requestId: RequestId,
  found: readonly StorySummary[],
): { stories: readonly StorySummary[]; moves: Model["moves"] } => {
  const stories = found
    .map((story) => {
      const move = model.moves.get(story.id);
      return move === undefined ? story : shownAfterRefresh(move, requestId, story);
    })
    .toSorted(orderFor(groupingOf(model.question.view)));
  const moves = new Map(model.moves);
  for (const [storyId, move] of model.moves) {
    const seen = found.find((story) => story.id === storyId)?.state;
    const next = moveAfterRefresh(move, requestId, seen);
    if (next === null) moves.delete(storyId);
    else moves.set(storyId, next);
  }
  return { stories, moves };
};
