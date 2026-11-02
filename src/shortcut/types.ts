export type StoryId = number & { readonly brand: "StoryId" };
export type MemberId = string & { readonly brand: "MemberId" };
export type WorkflowStateId = number & { readonly brand: "WorkflowStateId" };
export type EpicId = number & { readonly brand: "EpicId" };

export type StoryType = "feature" | "bug" | "chore";
export type Progress = "unstarted" | "started" | "done";

export type MemberRef = { id: MemberId; name: string };

export type Workspace = {
  me: { id: MemberId; name: string; mentionName: string };
  slug: string;
};

export type StorySummary = {
  id: StoryId;
  name: string;
  storyType: StoryType;
  state: {
    id: WorkflowStateId;
    name: string;
    workflowName: string;
    progress: Progress;
    position: number;
  };
  estimate: number | null;
  owners: readonly MemberRef[];
  epic: { id: EpicId; name: string } | null;
  appUrl: string;
  updatedAt: Date;
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
};

export type ShortcutClient = {
  loadWorkspace(): Promise<Workspace>;
  searchStories(query: string): Promise<readonly StorySummary[]>;
  getStory(id: StoryId): Promise<StoryDetail>;
};
