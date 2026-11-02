import type {
  MemberId,
  StoryDetail,
  StoryId,
  StorySummary,
  WorkflowStateId,
  Workspace,
} from "../shortcut/types.ts";

const isStoryId = (n: number): n is StoryId => Number.isSafeInteger(n) && n > 0;
const isMemberId = (s: string): s is MemberId => s.length > 0;
const isWorkflowStateId = (n: number): n is WorkflowStateId => Number.isSafeInteger(n);

export const storyId = (n: number): StoryId => {
  if (!isStoryId(n)) throw new RangeError(`bad story id ${String(n)}`);
  return n;
};

const memberId = (s: string): MemberId => {
  if (!isMemberId(s)) throw new RangeError("empty member id");
  return s;
};

const workflowStateId = (n: number): WorkflowStateId => {
  if (!isWorkflowStateId(n)) throw new RangeError(`bad workflow state id ${String(n)}`);
  return n;
};

export const workspaceFor = (mentionName: string): Workspace => {
  const me = { id: memberId("me"), name: "Me", mentionName };
  return {
    me,
    members: new Map([[me.id, me]]),
    workflowStates: new Map([
      [workflowStateId(1), { id: workflowStateId(1), name: "To Do", kind: "unstarted" }],
    ]),
  };
};

export const summary = (id: number, name = `Story ${String(id)}`): StorySummary => ({
  id: storyId(id),
  name,
  storyType: "feature",
  workflowStateId: workflowStateId(1),
  estimate: null,
  ownerIds: [memberId("me")],
  epicId: null,
  appUrl: `https://app.shortcut.com/story/${String(id)}`,
  updatedAt: new Date(0),
});

export const detail = (id: number): StoryDetail => ({
  ...summary(id),
  description: `Description of ${String(id)}`,
  labels: [],
  comments: [],
});
