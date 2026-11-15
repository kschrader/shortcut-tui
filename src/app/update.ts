import type { StoryDetail, StoryId, StorySummary, Workspace } from "../shortcut/types.ts";
import type {
  Model,
  Msg,
  Question,
  Reload,
  Remote,
  RequestId,
  StartupList,
  Step,
} from "./model.ts";
import { applyMove, carryMoves, nextMove, pickerStates, withSubTask } from "./moves.ts";
import {
  ageFloorFrom,
  draftFor,
  filterAfter,
  queriesFor,
  queryView,
  sameQuestion,
} from "./filters.ts";
import { noticed } from "./glance.ts";
import { rowInPlaceOf, shownStories } from "./rows.ts";
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
import {
  noPullRequests,
  savedForStartup,
  showsCachedList,
  startupQuestion,
  startupView,
} from "./startup.ts";

const browsing: Model["focus"] = { mode: "browsing" };

const FOCUS_REFRESH_AFTER_MS = 30_000;

const search = (model: Model, workspace: Workspace, question: Question): Step => {
  const requestId = model.nextRequestId;
  const same =
    model.results.status === "loaded" && sameQuestion(model.results.value.question, question);
  return [
    {
      ...model,
      question,
      results: same ? refetch(model.results, requestId) : firstLoad(requestId),
      selectedStoryId: same || !showsCachedList(model) ? model.selectedStoryId : null,
      pullRequests: same ? model.pullRequests : noPullRequests,
      focus: model.focus.mode === "picking" ? browsing : model.focus,
      nextRequestId: requestIdAfter(requestId),
    },
    [{ type: "searchStories", requestId, queries: queriesFor(question, workspace) }],
  ];
};

const fetchDetail = (model: Model, storyId: StoryId): Step => {
  if (showsCachedList(model)) return [model, []];
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

const storyIn = (model: Model, storyId: StoryId | null): StorySummary | null =>
  shownStories(model).find((story) => story.id === storyId) ?? null;

const shownSelection = (model: Model): StoryId | null =>
  storyIn(model, model.selectedStoryId)?.id ?? shownStories(model)[0]?.id ?? null;

const closePickerOnHidden = (model: Model): Model => {
  const { focus } = model;
  return focus.mode === "picking" && storyIn(model, focus.storyId) === null
    ? { ...model, focus: browsing }
    : model;
};

const followLeavingRow = (before: Model, after: Model): Step => {
  const settled = closePickerOnHidden(after);
  const selected = before.selectedStoryId;
  if (selected === null || storyIn(settled, selected) !== null) return [settled, []];
  return select(settled, rowInPlaceOf(shownStories(before), shownStories(settled), selected));
};

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
      const [searching, searchEffects] = search(model, model.workspace.value, model.question);
      if (model.selectedStoryId === null) return [searching, searchEffects];
      const [fetching, detailEffects] = fetchDetail(searching, model.selectedStoryId);
      return [fetching, [...searchEffects, ...detailEffects]];
    }
  }
};

const refreshWhenIdle = (model: Model): Step => {
  const nothingInFlight =
    model.focus.mode === "browsing" &&
    awaited(model.results) === null &&
    inFlight(model.pullRequests.reload) === null;
  return nothingInFlight ? refresh(model) : [model, []];
};

const isStale = (model: Model, at: Date): boolean =>
  model.loadedAt === null || at.getTime() - model.loadedAt.getTime() >= FOCUS_REFRESH_AFTER_MS;

const resultsArrived = (
  model: Model,
  requestId: RequestId,
  found: readonly StorySummary[],
  loadedAt: Date,
): Step => {
  const { stories, moves } = carryMoves(model, requestId, found);
  const results = loaded({ question: model.question, stories, cachedAt: null });
  const [checking, pullRequestEffects] = loadPullRequests(
    { ...model, results, loadedAt, moves },
    stories,
  );
  const shown = closePickerOnHidden(checking);
  const [selected, detailEffects] = select(shown, shownSelection(shown));
  return [selected, [...detailEffects, ...pullRequestEffects, ...savedForStartup(shown, loadedAt)]];
};

export const init = (saved: StartupList | null = null): Step => {
  const requestId = firstRequestId;
  return [
    {
      workspace: firstLoad(requestId),
      ...startupView(saved),
      loadedAt: null,
      details: new Map(),
      pullRequests: noPullRequests,
      moves: new Map(),
      focus: browsing,
      nextRequestId: requestIdAfter(requestId),
    },
    [{ type: "loadWorkspace", requestId }],
  ];
};

const transition = (model: Model, msg: Msg): Step => {
  switch (msg.type) {
    case "workspaceLoaded": {
      if (!isAwaiting(model.workspace, msg.requestId)) return [model, []];
      const withWorkspace: Model = { ...model, workspace: loaded(msg.workspace) };
      return search(withWorkspace, msg.workspace, startupQuestion(msg.workspace.me.mentionName));
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
      const checked = closePickerOnHidden({
        ...model,
        pullRequests: { value: msg.pullRequests, reload: idle },
      });
      const selection = shownSelection(checked);
      return selection === checked.selectedStoryId ? [checked, []] : select(checked, selection);
    }
    case "pullRequestsFailed": {
      if (inFlight(model.pullRequests.reload) !== msg.requestId) return [model, []];
      const reload: Reload = { status: "failed", message: msg.message };
      return [{ ...model, pullRequests: { ...model.pullRequests, reload } }, []];
    }
    case "moveSucceeded": {
      const { requestId, storyId, story } = msg;
      const step = nextMove(
        model.moves.get(storyId),
        { type: "confirmed", requestId, state: story.state, movedAt: story.movedAt },
        model.nextRequestId,
      );
      if (step === null) return [model, []];
      const details = withSubTask(model.details, story);
      const applied = applyMove({ ...model, details }, storyId, step, story);
      return step.kind === "hold" ? followLeavingRow(model, applied[0]) : applied;
    }
    case "moveFailed": {
      const { requestId, storyId, message } = msg;
      const step = nextMove(
        model.moves.get(storyId),
        { type: "refused", requestId, message },
        model.nextRequestId,
      );
      return step === null ? [model, []] : applyMove(model, storyId, step);
    }
    case "selectionMoved": {
      const stories = shownStories(model);
      if (stories.length === 0) return [model, []];
      const current = stories.findIndex((story) => story.id === model.selectedStoryId);
      const target = Math.min(Math.max(current + msg.delta, 0), stories.length - 1);
      return select(model, stories[target]?.id ?? null);
    }
    case "storyClicked": {
      if (model.focus.mode !== "browsing" || storyIn(model, msg.storyId) === null) {
        return [model, []];
      }
      return select(model, msg.storyId);
    }
    case "queryEditStarted": {
      if (model.workspace.status !== "loaded" || model.focus.mode !== "browsing") {
        return [model, []];
      }
      const draft = draftFor(model.question.view);
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
      if (model.focus.mode !== "editingQuery" || model.workspace.status !== "loaded") {
        return [model, []];
      }
      const question = { ...model.question, view: queryView(model.focus.draft.trim()) };
      return search({ ...model, focus: browsing }, model.workspace.value, question);
    }
    case "filterCycled": {
      if (model.workspace.status !== "loaded" || model.focus.mode !== "browsing") {
        return [model, []];
      }
      const workspace = model.workspace.value;
      const view = filterAfter(model.question.view, workspace).viewFor(workspace);
      return search(model, workspace, { ...model.question, view });
    }
    case "ageFloorToggled": {
      if (model.workspace.status !== "loaded" || model.focus.mode !== "browsing") {
        return [model, []];
      }
      const movedOnOrBefore = model.question.movedOnOrBefore === null ? ageFloorFrom(msg.at) : null;
      return search(model, model.workspace.value, { ...model.question, movedOnOrBefore });
    }
    case "refreshRequested":
      return refresh(model);
    case "autoRefreshDue":
      return refreshWhenIdle(model);
    case "terminalFocused":
      return isStale(model, msg.at) ? refreshWhenIdle(model) : [model, []];
    case "helpOpened": {
      if (model.focus.mode !== "browsing") return [model, []];
      return [{ ...model, focus: { mode: "help" } }, []];
    }
    case "helpClosed": {
      if (model.focus.mode !== "help") return [model, []];
      return [{ ...model, focus: browsing }, []];
    }
    case "movePickerOpened": {
      const blocked = model.focus.mode !== "browsing" || showsCachedList(model);
      if (blocked || model.workspace.status !== "loaded") return [model, []];
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
      if (target === undefined) return [closed, []];
      const step = nextMove(
        model.moves.get(story.id),
        { type: "picked", target, shown: story.state },
        model.nextRequestId,
      );
      return step === null ? [closed, []] : applyMove(closed, story.id, step);
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

export const update = (model: Model, msg: Msg): Step => {
  const [next, effects] = transition(model, msg);
  return next === model ? [model, effects] : [{ ...next, seen: noticed(model, next) }, effects];
};
