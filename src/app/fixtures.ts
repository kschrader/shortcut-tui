import type {
  MemberId,
  Progress,
  StoryDetail,
  StoryId,
  StorySummary,
  WorkflowId,
  WorkflowState,
  WorkflowStateId,
  Workspace,
} from "../shortcut/types.ts";

const isStoryId = (n: number): n is StoryId => Number.isSafeInteger(n) && n > 0;
const isMemberId = (s: string): s is MemberId => s.length > 0;
const isWorkflowId = (n: number): n is WorkflowId => Number.isSafeInteger(n);
const isWorkflowStateId = (n: number): n is WorkflowStateId => Number.isSafeInteger(n);

export const storyId = (n: number): StoryId => {
  if (!isStoryId(n)) throw new RangeError(`bad story id ${String(n)}`);
  return n;
};

const memberId = (s: string): MemberId => {
  if (!isMemberId(s)) throw new RangeError("empty member id");
  return s;
};

const workflowId = (n: number): WorkflowId => {
  if (!isWorkflowId(n)) throw new RangeError(`bad workflow id ${String(n)}`);
  return n;
};

export const workflowStateId = (n: number): WorkflowStateId => {
  if (!isWorkflowStateId(n)) throw new RangeError(`bad workflow state id ${String(n)}`);
  return n;
};

export const engineering = { id: workflowId(1), name: "Engineering" };

export const workflowState = (
  id: number,
  name: string,
  progress: Progress,
  position: number,
  workflow: { id: number; name: string } = engineering,
): WorkflowState => ({
  id: workflowStateId(id),
  name,
  progress,
  position,
  workflow: { id: workflowId(workflow.id), name: workflow.name },
});

export const toDo = workflowState(1, "To Do", "unstarted", 0);
export const doing = workflowState(2, "Doing", "started", 1);
export const finished = workflowState(3, "Finished", "done", 2);
export const readyForReview = workflowState(4, "Ready for Review", "started", 1, {
  id: 2,
  name: "Design",
});
export const codeReview = workflowState(5, "Waiting for code review", "started", 1, {
  id: 3,
  name: "Support",
});
export const workflowStates: readonly WorkflowState[] = [
  toDo,
  doing,
  finished,
  readyForReview,
  codeReview,
];

export const workspaceFor = (mentionName: string, canWrite = true): Workspace => ({
  me: { id: memberId("me"), name: "Me", mentionName },
  slug: "acme",
  canWrite,
  workflowStates,
});

export const summary = (id: number, name = `Story ${String(id)}`): StorySummary => ({
  id: storyId(id),
  name,
  storyType: "feature",
  state: toDo,
  estimate: null,
  owners: [{ id: memberId("me"), name: "Me" }],
  epic: null,
  appUrl: `https://app.shortcut.com/story/${String(id)}`,
  branchName: `me/sc-${String(id)}/story-${String(id)}`,
  updatedAt: new Date(0),
  movedAt: new Date(0),
  pullRequestCount: 0,
  parent: null,
  subTaskCount: 0,
});

export const ownedBy = (story: StorySummary, ...names: readonly string[]): StorySummary => ({
  ...story,
  owners: names.map((name) => ({ id: memberId(name.toLowerCase()), name })),
});

export const inState = (
  story: StorySummary,
  state: Pick<WorkflowState, "name" | "progress" | "position"> & {
    id?: number;
    workflow?: { id: number; name: string };
  },
  updatedAt = story.updatedAt,
): StorySummary => ({
  ...story,
  state: workflowState(
    state.id ?? 100 + state.position,
    state.name,
    state.progress,
    state.position,
    state.workflow,
  ),
  updatedAt,
});

export const detail = (id: number): StoryDetail => ({
  ...summary(id),
  description: `Description of ${String(id)}`,
  labels: [],
  comments: [],
  subTasks: [],
});
