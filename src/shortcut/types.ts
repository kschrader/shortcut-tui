export type StoryId = number & { readonly brand: "StoryId" };
export type MemberId = string & { readonly brand: "MemberId" };
export type WorkflowStateId = number & { readonly brand: "WorkflowStateId" };
export type EpicId = number & { readonly brand: "EpicId" };

export type StoryType = "feature" | "bug" | "chore";
export type WorkflowStateKind = "unstarted" | "started" | "done";

export type WorkflowState = {
  id: WorkflowStateId;
  name: string;
  kind: WorkflowStateKind;
};

export type Member = {
  id: MemberId;
  name: string;
  mentionName: string;
};

export type Workspace = {
  me: Member;
  members: ReadonlyMap<MemberId, Member>;
  workflowStates: ReadonlyMap<WorkflowStateId, WorkflowState>;
};

export type StorySummary = {
  id: StoryId;
  name: string;
  storyType: StoryType;
  workflowStateId: WorkflowStateId;
  estimate: number | null;
  ownerIds: readonly MemberId[];
  epicId: EpicId | null;
  appUrl: string;
  updatedAt: Date;
};

export type StoryComment = {
  id: number;
  authorId: MemberId | null;
  text: string;
  createdAt: Date;
};

export type StoryDetail = StorySummary & {
  description: string;
  labels: readonly string[];
  comments: readonly StoryComment[];
};

export type ShortcutClient = {
  loadWorkspace(): Promise<Workspace>;
  searchStories(query: string): Promise<readonly StorySummary[]>;
  getStory(id: StoryId): Promise<StoryDetail>;
};
