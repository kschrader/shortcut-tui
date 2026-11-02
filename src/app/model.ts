import type { StoryDetail, StoryId, StorySummary, Workspace } from "../shortcut/types.ts";

export type RequestId = number & { readonly brand: "RequestId" };

export type Remote<T> =
  | { status: "loading"; requestId: RequestId }
  | { status: "loaded"; value: T }
  | { status: "failed"; message: string };

export type SearchResults = { query: string; stories: readonly StorySummary[] };

export type Focus = { mode: "browsing" } | { mode: "editingQuery"; draft: string };

export type Model = {
  workspace: Remote<Workspace>;
  query: string;
  results: Remote<SearchResults>;
  selectedStoryId: StoryId | null;
  details: ReadonlyMap<StoryId, Remote<StoryDetail>>;
  focus: Focus;
  nextRequestId: RequestId;
};

export type Msg =
  | { type: "workspaceLoaded"; requestId: RequestId; workspace: Workspace }
  | { type: "workspaceFailed"; requestId: RequestId; message: string }
  | { type: "searchSucceeded"; requestId: RequestId; stories: readonly StorySummary[] }
  | { type: "searchFailed"; requestId: RequestId; message: string }
  | { type: "detailSucceeded"; requestId: RequestId; story: StoryDetail }
  | { type: "detailFailed"; requestId: RequestId; storyId: StoryId; message: string }
  | { type: "selectionMoved"; delta: number }
  | { type: "queryEditStarted" }
  | { type: "queryDraftChanged"; draft: string }
  | { type: "queryEditCancelled" }
  | { type: "querySubmitted" }
  | { type: "refreshRequested" };

export type Effect =
  | { type: "loadWorkspace"; requestId: RequestId }
  | { type: "searchStories"; requestId: RequestId; query: string }
  | { type: "getStory"; requestId: RequestId; storyId: StoryId };
