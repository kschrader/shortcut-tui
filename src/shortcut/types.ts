import type { PullRequestRef } from "../github/types.ts";

export type StoryId = number & { readonly brand: "StoryId" };
export type MemberId = string & { readonly brand: "MemberId" };
export type WorkflowId = number & { readonly brand: "WorkflowId" };
export type WorkflowStateId = number & { readonly brand: "WorkflowStateId" };
export type EpicId = number & { readonly brand: "EpicId" };
export type PullRequestId = number & { readonly brand: "PullRequestId" };

export type StoryType = "feature" | "bug" | "chore";
export type Progress = "unstarted" | "started" | "done";

export type MemberRef = { id: MemberId; name: string };

export type WorkflowState = {
  id: WorkflowStateId;
  name: string;
  progress: Progress;
  position: number;
  workflow: { id: WorkflowId; name: string };
};

export type Workspace = {
  me: { id: MemberId; name: string; mentionName: string };
  slug: string;
  canWrite: boolean;
  workflowStates: readonly WorkflowState[];
};

export type StoryRef = { id: StoryId; name: string; appUrl: string };

export type StorySummary = {
  id: StoryId;
  name: string;
  storyType: StoryType;
  state: WorkflowState;
  estimate: number | null;
  owners: readonly MemberRef[];
  epic: { id: EpicId; name: string } | null;
  appUrl: string;
  branchName: string | null;
  updatedAt: Date;
  movedAt: Date;
  pullRequestCount: number;
  parent: StoryRef | null;
  subTaskCount: number;
  blocked: boolean;
  blocker: boolean;
};

export type StoryComment = {
  id: number;
  author: MemberRef | null;
  text: string;
  createdAt: Date;
};

export type StoryDetail = StorySummary & {
  description: string;
  labels: readonly string[];
  comments: readonly StoryComment[];
  subTasks: readonly StorySummary[];
};

export type LinkedPullRequest = {
  id: PullRequestId;
  title: string;
  url: string;
  closed: boolean;
  draft: boolean;
  github: PullRequestRef | null;
};

export type ShortcutClient = {
  loadWorkspace(): Promise<Workspace>;
  searchStories(query: string): Promise<readonly StorySummary[]>;
  getStory(id: StoryId): Promise<StoryDetail>;
  listPullRequests(id: StoryId): Promise<readonly LinkedPullRequest[]>;
  moveStory(id: StoryId, stateId: WorkflowStateId): Promise<StorySummary>;
};
