import { epicId, memberId, pullRequestId, workflowId, workflowStateId } from "./schemas.ts";
import type {
  LinkedPullRequest,
  MemberRef,
  Progress,
  StoryComment,
  WorkflowState,
  Workspace,
} from "./types.ts";

const member = (id: string, name: string): MemberRef => ({ id: memberId.parse(id), name });

export const me = member("00000000-0000-4000-8000-000000000001", "Demo User");
export const alex = member("00000000-0000-4000-8000-000000000002", "Alex Rivera");
export const priya = member("00000000-0000-4000-8000-000000000003", "Priya Shah");
export const sam = member("00000000-0000-4000-8000-000000000004", "Sam Okafor");

const engineering = { id: workflowId.parse(500000100), name: "Engineering" };

const state = (id: number, name: string, progress: Progress, position: number): WorkflowState => ({
  id: workflowStateId.parse(id),
  name,
  progress,
  position,
  workflow: engineering,
});

export const backlog = state(500000001, "Backlog", "unstarted", 0);
export const ready = state(500000002, "Ready for Development", "unstarted", 1);
export const inProgress = state(500000003, "In Progress", "started", 2);
export const inReview = state(500000004, "In Review", "started", 3);
export const done = state(500000005, "Done", "done", 4);

export const DEMO_WORKFLOW_STATES: readonly WorkflowState[] = [
  backlog,
  ready,
  inProgress,
  inReview,
  done,
];

export const workspace: Workspace = {
  me: { ...me, mentionName: "demo" },
  slug: "demo",
  canWrite: true,
  workflowStates: DEMO_WORKFLOW_STATES,
};

export const epics = {
  shortcuts: { id: epicId.parse(90), name: "Keyboard-first navigation" },
  reporting: { id: epicId.parse(91), name: "Iteration reporting" },
};

export const comment = (
  id: number,
  author: MemberRef | null,
  text: string,
  createdAt: string,
): StoryComment => ({
  id,
  author,
  text,
  createdAt: new Date(createdAt),
});

export const DEMO_REPOSITORY = { owner: "demo", repo: "app" };

export const pullRequest = (
  number: number,
  title: string,
  { closed = false, draft = false } = {},
): LinkedPullRequest => ({
  id: pullRequestId.parse(700000 + number),
  title,
  url: `https://github.com/${DEMO_REPOSITORY.owner}/${DEMO_REPOSITORY.repo}/pull/${String(number)}`,
  closed,
  draft,
  github: { ...DEMO_REPOSITORY, number },
});

export const mergeRequest = (
  iid: number,
  title: string,
  { closed = false } = {},
): LinkedPullRequest => ({
  id: pullRequestId.parse(800000 + iid),
  title,
  url: `https://gitlab.com/demo/infra/-/merge_requests/${String(iid)}`,
  closed,
  draft: false,
  github: null,
});
