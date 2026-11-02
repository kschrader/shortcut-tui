import type { PullRequestState } from "../github/types.ts";
import type {
  LinkedPullRequest,
  StoryDetail,
  StoryId,
  StorySummary,
  Workspace,
} from "../shortcut/types.ts";

export type RequestId = number & { readonly brand: "RequestId" };

export type Remote<T> =
  | { status: "loading"; requestId: RequestId }
  | { status: "loaded"; value: T }
  | { status: "failed"; message: string };

export type SearchResults = { query: string; stories: readonly StorySummary[] };

export type PullRequestView = LinkedPullRequest & { state: PullRequestState };

export type StoryPullRequests = ReadonlyMap<StoryId, readonly PullRequestView[]>;

export type Focus = { mode: "browsing" } | { mode: "editingQuery"; draft: string };

export type Model = {
  workspace: Remote<Workspace>;
  query: string;
  results: Remote<SearchResults>;
  selectedStoryId: StoryId | null;
  details: ReadonlyMap<StoryId, Remote<StoryDetail>>;
  pullRequests: Remote<StoryPullRequests>;
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
  | { type: "pullRequestsLoaded"; requestId: RequestId; pullRequests: StoryPullRequests }
  | { type: "pullRequestsFailed"; requestId: RequestId; message: string }
  | { type: "selectionMoved"; delta: number }
  | { type: "queryEditStarted" }
  | { type: "queryDraftChanged"; draft: string }
  | { type: "queryEditCancelled" }
  | { type: "querySubmitted" }
  | { type: "refreshRequested" };

export type Effect =
  | { type: "loadWorkspace"; requestId: RequestId }
  | { type: "searchStories"; requestId: RequestId; query: string }
  | { type: "getStory"; requestId: RequestId; storyId: StoryId }
  | { type: "loadPullRequests"; requestId: RequestId; storyIds: readonly StoryId[] };
