import type { StoryMergeStatus } from "../github/pull-request-state.ts";
import type { PullRequestState, Reviews } from "../github/types.ts";
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

export type Reload =
  | { status: "idle" }
  | { status: "inFlight"; requestId: RequestId }
  | { status: "failed"; message: string };

export type Cached<T> = { value: T; reload: Reload };

export type Remote<T> =
  | { status: "firstLoad"; requestId: RequestId }
  | { status: "failed"; message: string }
  | ({ status: "loaded" } & Cached<T>);

export type Settled<T> = { status: "loaded"; value: T } | { status: "failed"; message: string };

export type View = { kind: "query"; text: string } | { kind: "inReview" };

export type CalendarDay = string & { readonly brand: "CalendarDay" };

export type Question = { view: View; movedOnOrBefore: CalendarDay | null };

export type SearchResults = { question: Question; stories: readonly StorySummary[] };

export type PullRequestView = LinkedPullRequest & {
  state: PullRequestState;
  reviews: Reviews | null;
};

export type StoryPullRequests = ReadonlyMap<StoryId, Settled<readonly PullRequestView[]>>;

export type Glance = {
  state: WorkflowState;
  updatedAt: Date;
  mergeStatus: StoryMergeStatus | null;
};

export type Change =
  | { kind: "new" }
  | { kind: "state"; from: WorkflowState; to: WorkflowState }
  | { kind: "pullRequests"; from: StoryMergeStatus; to: StoryMergeStatus }
  | { kind: "edited" };

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
  question: Question;
  results: Remote<SearchResults>;
  loadedAt: Date | null;
  selectedStoryId: StoryId | null;
  details: ReadonlyMap<StoryId, Remote<StoryDetail>>;
  pullRequests: Cached<StoryPullRequests>;
  moves: ReadonlyMap<StoryId, StoryMove>;
  seen: ReadonlyMap<StoryId, Glance>;
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
  | { type: "storyClicked"; storyId: StoryId }
  | { type: "queryEditStarted" }
  | { type: "queryDraftChanged"; draft: string }
  | { type: "queryEditCancelled" }
  | { type: "querySubmitted" }
  | { type: "filterCycled" }
  | { type: "ageFloorToggled"; at: Date }
  | { type: "refreshRequested" }
  | { type: "autoRefreshDue" }
  | { type: "terminalFocused"; at: Date }
  | { type: "helpOpened" }
  | { type: "helpClosed" }
  | { type: "movePickerOpened" }
  | { type: "movePickerMoved"; delta: number }
  | { type: "movePickerConfirmed" }
  | { type: "movePickerClosed" }
  | { type: "readOnlyNoticeClosed" };

export type Step = [Model, Effect[]];

export type Effect =
  | { type: "loadWorkspace"; requestId: RequestId }
  | { type: "searchStories"; requestId: RequestId; queries: readonly string[] }
  | { type: "getStory"; requestId: RequestId; storyId: StoryId }
  | { type: "loadPullRequests"; requestId: RequestId; storyIds: readonly StoryId[] }
  | { type: "moveStory"; requestId: RequestId; storyId: StoryId; stateId: WorkflowStateId };
