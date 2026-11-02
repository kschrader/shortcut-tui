import type { PullRequestState } from "../github/types.ts";
import type {
  LinkedPullRequest,
  StoryDetail,
  StoryId,
  StorySummary,
  WorkflowState,
  WorkflowStateId,
  Workspace,
} from "../shortcut/types.ts";

export type RequestId = number & { readonly brand: "RequestId" };

export type Remote<T> =
  | { status: "loading"; requestId: RequestId }
  | { status: "loaded"; value: T }
  | { status: "failed"; message: string };

export type SearchResults = { query: string; stories: readonly StorySummary[] };

export type PullRequestView = LinkedPullRequest & { state: PullRequestState };

export type Settled<T> = Exclude<Remote<T>, { status: "loading" }>;

export type StoryPullRequests = ReadonlyMap<StoryId, Settled<readonly PullRequestView[]>>;

export type Focus =
  | { mode: "browsing" }
  | { mode: "editingQuery"; draft: string }
  | { mode: "help" }
  | { mode: "picking"; storyId: StoryId; cursor: number }
  | { mode: "readOnly" };

export type ServerKnown = {
  known: WorkflowState;
  trustFrom: RequestId;
};

export type StoryMove =
  | (ServerKnown & {
      status: "saving";
      requestId: RequestId;
      target: WorkflowState;
      pending: WorkflowState | null;
    })
  | (ServerKnown & { status: "moved" })
  | (ServerKnown & { status: "failed"; message: string });

export type Model = {
  workspace: Remote<Workspace>;
  query: string;
  results: Remote<SearchResults>;
  loadedAt: Date | null;
  selectedStoryId: StoryId | null;
  details: ReadonlyMap<StoryId, Remote<StoryDetail>>;
  pullRequests: Remote<StoryPullRequests>;
  moves: ReadonlyMap<StoryId, StoryMove>;
  focus: Focus;
  nextRequestId: RequestId;
};

export type Msg =
  | { type: "workspaceLoaded"; requestId: RequestId; workspace: Workspace }
  | { type: "workspaceFailed"; requestId: RequestId; message: string }
  | {
      type: "searchSucceeded";
      requestId: RequestId;
      stories: readonly StorySummary[];
      loadedAt: Date;
    }
  | { type: "searchFailed"; requestId: RequestId; message: string }
  | { type: "detailSucceeded"; requestId: RequestId; story: StoryDetail }
  | { type: "detailFailed"; requestId: RequestId; storyId: StoryId; message: string }
  | { type: "pullRequestsLoaded"; requestId: RequestId; pullRequests: StoryPullRequests }
  | { type: "pullRequestsFailed"; requestId: RequestId; message: string }
  | { type: "moveSucceeded"; requestId: RequestId; storyId: StoryId; story: StorySummary }
  | { type: "moveFailed"; requestId: RequestId; storyId: StoryId; message: string }
  | { type: "selectionMoved"; delta: number }
  | { type: "queryEditStarted" }
  | { type: "queryDraftChanged"; draft: string }
  | { type: "queryEditCancelled" }
  | { type: "querySubmitted" }
  | { type: "refreshRequested" }
  | { type: "autoRefreshDue" }
  | { type: "helpOpened" }
  | { type: "helpClosed" }
  | { type: "movePickerOpened" }
  | { type: "movePickerMoved"; delta: number }
  | { type: "movePickerConfirmed" }
  | { type: "movePickerClosed" }
  | { type: "readOnlyNoticeClosed" };

export type Effect =
  | { type: "loadWorkspace"; requestId: RequestId }
  | { type: "searchStories"; requestId: RequestId; query: string }
  | { type: "getStory"; requestId: RequestId; storyId: StoryId }
  | { type: "loadPullRequests"; requestId: RequestId; storyIds: readonly StoryId[] }
  | { type: "moveStory"; requestId: RequestId; storyId: StoryId; stateId: WorkflowStateId };
