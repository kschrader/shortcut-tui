import type { Progress, StoryId, StorySummary } from "../shortcut/types.ts";
import type { Effect, Model, Msg, Remote, RequestId, StoryPullRequests } from "./model.ts";

type Step = [Model, Effect[]];

const isRequestId = (n: number): n is RequestId => Number.isSafeInteger(n) && n > 0;

const toRequestId = (n: number): RequestId => {
  if (!isRequestId(n)) throw new RangeError(`request id ${String(n)} is out of range`);
  return n;
};

const requestIdAfter = (id: RequestId): RequestId => toRequestId(id + 1);

const isAwaiting = <T>(remote: Remote<T> | undefined, requestId: RequestId): boolean =>
  remote?.status === "loading" && remote.requestId === requestId;

const noPullRequests: Remote<StoryPullRequests> = { status: "loaded", value: new Map() };

const search = (model: Model, query: string): Step => {
  const requestId = model.nextRequestId;
  return [
    {
      ...model,
      query,
      results: { status: "loading", requestId },
      pullRequests: noPullRequests,
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
      details: new Map(model.details).set(storyId, { status: "loading", requestId }),
      nextRequestId: requestIdAfter(requestId),
    },
    [{ type: "getStory", requestId, storyId }],
  ];
};

const loadPullRequests = (model: Model, stories: readonly StorySummary[]): Step => {
  const storyIds = stories.filter((story) => story.pullRequestCount > 0).map((story) => story.id);
  if (storyIds.length === 0) return [{ ...model, pullRequests: noPullRequests }, []];
  const requestId = model.nextRequestId;
  return [
    {
      ...model,
      pullRequests: { status: "loading", requestId },
      nextRequestId: requestIdAfter(requestId),
    },
    [{ type: "loadPullRequests", requestId, storyIds }],
  ];
};

const select = (model: Model, storyId: StoryId | null): Step => {
  const selected = { ...model, selectedStoryId: storyId };
  if (storyId === null) return [selected, []];
  const detail = model.details.get(storyId);
  if (detail === undefined || detail.status === "failed") return fetchDetail(selected, storyId);
  return [selected, []];
};

export const defaultQueryFor = (mentionName: string) =>
  `owner:${mentionName} is:started !is:archived`;

const progressRank: Record<Progress, number> = { unstarted: 0, started: 1, done: 2 };

const furthestAlongFirst = (a: StorySummary, b: StorySummary) =>
  progressRank[b.state.progress] - progressRank[a.state.progress] ||
  b.state.position - a.state.position ||
  a.state.workflowName.localeCompare(b.state.workflowName) ||
  a.state.id - b.state.id ||
  b.updatedAt.getTime() - a.updatedAt.getTime();

const refresh = (model: Model): Step => {
  switch (model.workspace.status) {
    case "loading":
      return [model, []];
    case "failed": {
      const requestId = model.nextRequestId;
      return [
        {
          ...model,
          workspace: { status: "loading", requestId },
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

export const init = (): Step => {
  const requestId = toRequestId(1);
  return [
    {
      workspace: { status: "loading", requestId },
      query: "",
      results: { status: "loaded", value: { query: "", stories: [] } },
      selectedStoryId: null,
      details: new Map(),
      pullRequests: noPullRequests,
      focus: { mode: "browsing" },
      nextRequestId: requestIdAfter(requestId),
    },
    [{ type: "loadWorkspace", requestId }],
  ];
};

export const update = (model: Model, msg: Msg): Step => {
  switch (msg.type) {
    case "workspaceLoaded": {
      if (!isAwaiting(model.workspace, msg.requestId)) return [model, []];
      const loaded: Model = { ...model, workspace: { status: "loaded", value: msg.workspace } };
      return search(loaded, defaultQueryFor(msg.workspace.me.mentionName));
    }
    case "workspaceFailed": {
      if (!isAwaiting(model.workspace, msg.requestId)) return [model, []];
      return [{ ...model, workspace: { status: "failed", message: msg.message } }, []];
    }
    case "searchSucceeded": {
      if (!isAwaiting(model.results, msg.requestId)) return [model, []];
      const stories = msg.stories.toSorted(furthestAlongFirst);
      const loaded: Model = {
        ...model,
        results: { status: "loaded", value: { query: model.query, stories } },
      };
      const kept = stories.some((story) => story.id === model.selectedStoryId);
      const [selected, detailEffects] = select(
        loaded,
        kept ? model.selectedStoryId : (stories[0]?.id ?? null),
      );
      const [checking, pullRequestEffects] = loadPullRequests(selected, stories);
      return [checking, [...detailEffects, ...pullRequestEffects]];
    }
    case "searchFailed": {
      if (!isAwaiting(model.results, msg.requestId)) return [model, []];
      return [{ ...model, results: { status: "failed", message: msg.message } }, []];
    }
    case "detailSucceeded": {
      if (!isAwaiting(model.details.get(msg.story.id), msg.requestId)) return [model, []];
      const details = new Map(model.details).set(msg.story.id, {
        status: "loaded",
        value: msg.story,
      });
      return [{ ...model, details }, []];
    }
    case "detailFailed": {
      if (!isAwaiting(model.details.get(msg.storyId), msg.requestId)) return [model, []];
      const details = new Map(model.details).set(msg.storyId, {
        status: "failed",
        message: msg.message,
      });
      return [{ ...model, details }, []];
    }
    case "pullRequestsLoaded": {
      if (!isAwaiting(model.pullRequests, msg.requestId)) return [model, []];
      return [{ ...model, pullRequests: { status: "loaded", value: msg.pullRequests } }, []];
    }
    case "pullRequestsFailed": {
      if (!isAwaiting(model.pullRequests, msg.requestId)) return [model, []];
      return [{ ...model, pullRequests: { status: "failed", message: msg.message } }, []];
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
      if (model.workspace.status !== "loaded") return [model, []];
      const draft = model.query === "" ? "" : `${model.query} `;
      return [{ ...model, focus: { mode: "editingQuery", draft } }, []];
    }
    case "queryDraftChanged": {
      if (model.focus.mode !== "editingQuery") return [model, []];
      return [{ ...model, focus: { mode: "editingQuery", draft: msg.draft } }, []];
    }
    case "queryEditCancelled":
      return [{ ...model, focus: { mode: "browsing" } }, []];
    case "querySubmitted": {
      if (model.focus.mode !== "editingQuery") return [model, []];
      return search({ ...model, focus: { mode: "browsing" } }, model.focus.draft.trim());
    }
    case "refreshRequested":
      return refresh(model);
  }
};
