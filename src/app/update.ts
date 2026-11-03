import type { StoryDetail, StoryId, StorySummary } from "../shortcut/types.ts";
import type {
  Cached,
  Model,
  Msg,
  Reload,
  Remote,
  RequestId,
  Step,
  StoryPullRequests,
} from "./model.ts";
import { carryMoves, pickerStates, restate, startMove } from "./moves.ts";
import {
  awaited,
  fail,
  firstLoad,
  firstRequestId,
  idle,
  inFlight,
  isAwaiting,
  loaded,
  refetch,
  reloadFailure,
  requestIdAfter,
} from "./remote.ts";

const noPullRequests: Cached<StoryPullRequests> = { value: new Map(), reload: idle };

const browsing: Model["focus"] = { mode: "browsing" };

const search = (model: Model, query: string): Step => {
  const requestId = model.nextRequestId;
  const sameQuestion = model.results.status === "loaded" && model.results.value.query === query;
  return [
    {
      ...model,
      query,
      results: sameQuestion ? refetch(model.results, requestId) : firstLoad(requestId),
      pullRequests: sameQuestion ? model.pullRequests : noPullRequests,
      focus: model.focus.mode === "picking" ? browsing : model.focus,
      nextRequestId: requestIdAfter(requestId),
    },
    [{ type: "searchStories", requestId, query }],
  ];
};

const fetchDetail = (model: Model, storyId: StoryId): Step => {
  const requestId = model.nextRequestId;
  return [
    {
      ...model,
      details: new Map(model.details).set(storyId, refetch(model.details.get(storyId), requestId)),
      nextRequestId: requestIdAfter(requestId),
    },
    [{ type: "getStory", requestId, storyId }],
  ];
};

const loadPullRequests = (model: Model, stories: readonly StorySummary[]): Step => {
  const storyIds = stories.filter((story) => story.pullRequestCount > 0).map((story) => story.id);
  if (storyIds.length === 0) return [{ ...model, pullRequests: noPullRequests }, []];
  const requestId = model.nextRequestId;
  const kept = new Map([...model.pullRequests.value].filter(([id]) => storyIds.includes(id)));
  return [
    {
      ...model,
      pullRequests: { value: kept, reload: { status: "inFlight", requestId } },
      nextRequestId: requestIdAfter(requestId),
    },
    [{ type: "loadPullRequests", requestId, storyIds }],
  ];
};

const needsFetch = (detail: Remote<StoryDetail> | undefined): boolean => {
  switch (detail?.status) {
    case undefined:
    case "failed":
      return true;
    case "firstLoad":
      return false;
    case "loaded":
      return reloadFailure(detail) !== null;
  }
};

const select = (model: Model, storyId: StoryId | null): Step => {
  const selected = { ...model, selectedStoryId: storyId };
  if (storyId === null) return [selected, []];
  if (needsFetch(model.details.get(storyId))) return fetchDetail(selected, storyId);
  return [selected, []];
};

export const defaultQueryFor = (mentionName: string) =>
  `owner:${mentionName} is:started !is:archived`;

const storyIn = (model: Model, storyId: StoryId | null): StorySummary | null =>
  model.results.status === "loaded"
    ? (model.results.value.stories.find((story) => story.id === storyId) ?? null)
    : null;

const refresh = (model: Model): Step => {
  switch (model.workspace.status) {
    case "firstLoad":
      return [model, []];
    case "failed": {
      const requestId = model.nextRequestId;
      return [
        {
          ...model,
          workspace: firstLoad(requestId),
          nextRequestId: requestIdAfter(requestId),
        },
        [{ type: "loadWorkspace", requestId }],
      ];
    }
    case "loaded": {
      const [searching, searchEffects] = search(model, model.query);
      if (model.selectedStoryId === null) return [searching, searchEffects];
      const [fetching, detailEffects] = fetchDetail(searching, model.selectedStoryId);
      return [fetching, [...searchEffects, ...detailEffects]];
    }
  }
};

const resultsArrived = (
  model: Model,
  requestId: RequestId,
  found: readonly StorySummary[],
  loadedAt: Date,
): Step => {
  const { stories, moves } = carryMoves(model, requestId, found);
  const { focus } = model;
  const pickingGone =
    focus.mode === "picking" && !stories.some((story) => story.id === focus.storyId);
  const shown: Model = {
    ...model,
    results: loaded({ query: model.query, stories }),
    loadedAt,
    moves,
    focus: pickingGone ? browsing : focus,
  };
  const kept = stories.some((story) => story.id === model.selectedStoryId);
  const [selected, detailEffects] = select(
    shown,
    kept ? model.selectedStoryId : (stories[0]?.id ?? null),
  );
  const [checking, pullRequestEffects] = loadPullRequests(selected, stories);
  return [checking, [...detailEffects, ...pullRequestEffects]];
};

export const init = (): Step => {
  const requestId = firstRequestId;
  return [
    {
      workspace: firstLoad(requestId),
      query: "",
      results: loaded({ query: "", stories: [] }),
      loadedAt: null,
      selectedStoryId: null,
      details: new Map(),
      pullRequests: noPullRequests,
      moves: new Map(),
      focus: browsing,
      nextRequestId: requestIdAfter(requestId),
    },
    [{ type: "loadWorkspace", requestId }],
  ];
};

export const update = (model: Model, msg: Msg): Step => {
  switch (msg.type) {
    case "workspaceLoaded": {
      if (!isAwaiting(model.workspace, msg.requestId)) return [model, []];
      const withWorkspace: Model = { ...model, workspace: loaded(msg.workspace) };
      return search(withWorkspace, defaultQueryFor(msg.workspace.me.mentionName));
    }
    case "workspaceFailed": {
      if (!isAwaiting(model.workspace, msg.requestId)) return [model, []];
      return [{ ...model, workspace: fail(model.workspace, msg.message) }, []];
    }
    case "searchSucceeded": {
      if (!isAwaiting(model.results, msg.requestId)) return [model, []];
      return resultsArrived(model, msg.requestId, msg.stories, msg.loadedAt);
    }
    case "searchFailed": {
      if (!isAwaiting(model.results, msg.requestId)) return [model, []];
      return [{ ...model, results: fail(model.results, msg.message) }, []];
    }
    case "detailSucceeded": {
      if (!isAwaiting(model.details.get(msg.story.id), msg.requestId)) return [model, []];
      const details = new Map(model.details).set(msg.story.id, loaded(msg.story));
      return [{ ...model, details }, []];
    }
    case "detailFailed": {
      const detail = model.details.get(msg.storyId);
      if (detail === undefined || !isAwaiting(detail, msg.requestId)) return [model, []];
      const details = new Map(model.details).set(msg.storyId, fail(detail, msg.message));
      return [{ ...model, details }, []];
    }
    case "pullRequestsLoaded": {
      if (inFlight(model.pullRequests.reload) !== msg.requestId) return [model, []];
      return [{ ...model, pullRequests: { value: msg.pullRequests, reload: idle } }, []];
    }
    case "pullRequestsFailed": {
      if (inFlight(model.pullRequests.reload) !== msg.requestId) return [model, []];
      const reload: Reload = { status: "failed", message: msg.message };
      return [{ ...model, pullRequests: { ...model.pullRequests, reload } }, []];
    }
    case "moveSucceeded": {
      const move = model.moves.get(msg.storyId);
      if (move?.status !== "saving" || move.requestId !== msg.requestId) return [model, []];
      const known = msg.story.state;
      const trustFrom = model.nextRequestId;
      const replaced = restate(model, msg.storyId, known, msg.story);
      if (move.pending !== null && move.pending.id !== known.id) {
        return startMove(replaced, msg.storyId, move.pending, known, trustFrom);
      }
      const moves = new Map(model.moves).set(msg.storyId, { status: "moved", known, trustFrom });
      return [{ ...replaced, moves }, []];
    }
    case "moveFailed": {
      const move = model.moves.get(msg.storyId);
      if (move?.status !== "saving" || move.requestId !== msg.requestId) return [model, []];
      const { known, trustFrom } = move;
      if (move.pending !== null && move.pending.id !== known.id) {
        return startMove(model, msg.storyId, move.pending, known, trustFrom);
      }
      const moves = new Map(model.moves).set(msg.storyId, {
        status: "failed",
        message: msg.message,
        known,
        trustFrom,
      });
      return [{ ...restate(model, msg.storyId, known), moves }, []];
    }
    case "selectionMoved": {
      if (model.results.status !== "loaded") return [model, []];
      const { stories } = model.results.value;
      if (stories.length === 0) return [model, []];
      const current = stories.findIndex((story) => story.id === model.selectedStoryId);
      const target = Math.min(Math.max(current + msg.delta, 0), stories.length - 1);
      return select(model, stories[target]?.id ?? null);
    }
    case "queryEditStarted": {
      if (model.workspace.status !== "loaded" || model.focus.mode !== "browsing") {
        return [model, []];
      }
      const draft = model.query === "" ? "" : `${model.query} `;
      return [{ ...model, focus: { mode: "editingQuery", draft } }, []];
    }
    case "queryDraftChanged": {
      if (model.focus.mode !== "editingQuery") return [model, []];
      return [{ ...model, focus: { mode: "editingQuery", draft: msg.draft } }, []];
    }
    case "queryEditCancelled": {
      if (model.focus.mode !== "editingQuery") return [model, []];
      return [{ ...model, focus: browsing }, []];
    }
    case "querySubmitted": {
      if (model.focus.mode !== "editingQuery") return [model, []];
      return search({ ...model, focus: browsing }, model.focus.draft.trim());
    }
    case "refreshRequested":
      return refresh(model);
    case "autoRefreshDue": {
      const nothingInFlight =
        model.focus.mode === "browsing" &&
        awaited(model.results) === null &&
        inFlight(model.pullRequests.reload) === null;
      return nothingInFlight ? refresh(model) : [model, []];
    }
    case "helpOpened": {
      if (model.focus.mode !== "browsing") return [model, []];
      return [{ ...model, focus: { mode: "help" } }, []];
    }
    case "helpClosed": {
      if (model.focus.mode !== "help") return [model, []];
      return [{ ...model, focus: browsing }, []];
    }
    case "movePickerOpened": {
      if (model.focus.mode !== "browsing" || model.workspace.status !== "loaded") {
        return [model, []];
      }
      const story = storyIn(model, model.selectedStoryId);
      if (story === null) return [model, []];
      if (!model.workspace.value.canWrite) return [{ ...model, focus: { mode: "readOnly" } }, []];
      const cursor = pickerStates(model.workspace.value, story).findIndex(
        (state) => state.id === story.state.id,
      );
      return [
        { ...model, focus: { mode: "picking", storyId: story.id, cursor: Math.max(cursor, 0) } },
        [],
      ];
    }
    case "movePickerMoved": {
      if (model.focus.mode !== "picking" || model.workspace.status !== "loaded") {
        return [model, []];
      }
      const story = storyIn(model, model.focus.storyId);
      if (story === null) return [{ ...model, focus: browsing }, []];
      const last = pickerStates(model.workspace.value, story).length - 1;
      const cursor = Math.min(Math.max(model.focus.cursor + msg.delta, 0), last);
      return [{ ...model, focus: { ...model.focus, cursor } }, []];
    }
    case "movePickerConfirmed": {
      if (model.focus.mode !== "picking" || model.workspace.status !== "loaded") {
        return [model, []];
      }
      const closed: Model = { ...model, focus: browsing };
      const story = storyIn(model, model.focus.storyId);
      if (story === null) return [closed, []];
      const target = pickerStates(model.workspace.value, story)[model.focus.cursor];
      if (target === undefined || target.id === story.state.id) return [closed, []];
      const move = model.moves.get(story.id);
      if (move?.status === "saving") {
        const moves = new Map(model.moves).set(story.id, { ...move, pending: target });
        return [{ ...restate(closed, story.id, target), moves }, []];
      }
      return startMove(
        closed,
        story.id,
        target,
        move?.known ?? story.state,
        move?.trustFrom ?? firstRequestId,
      );
    }
    case "movePickerClosed": {
      if (model.focus.mode !== "picking") return [model, []];
      return [{ ...model, focus: browsing }, []];
    }
    case "readOnlyNoticeClosed": {
      if (model.focus.mode !== "readOnly") return [model, []];
      return [{ ...model, focus: browsing }, []];
    }
  }
};
