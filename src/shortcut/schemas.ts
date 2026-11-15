import { z } from "zod";
import type { PullRequestRef } from "../github/types.ts";
import type {
  ChecklistItem,
  EpicId,
  LinkedPullRequest,
  MemberId,
  MemberRef,
  Progress,
  PullRequestId,
  StoryComment,
  StoryDetail,
  StoryId,
  StoryRef,
  StorySummary,
  StoryType,
  WorkflowId,
  WorkflowState,
  WorkflowStateId,
  Workspace,
} from "./types.ts";

export const storyId = z.custom<StoryId>((value) => typeof value === "number");
export const memberId = z.custom<MemberId>((value) => typeof value === "string");
export const workflowId = z.custom<WorkflowId>((value) => typeof value === "number");
export const workflowStateId = z.custom<WorkflowStateId>((value) => typeof value === "number");
export const epicId = z.custom<EpicId>((value) => typeof value === "number");
export const pullRequestId = z.custom<PullRequestId>((value) => typeof value === "number");

const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const storyType = z.enum(["feature", "bug", "chore"]) satisfies z.ZodType<StoryType>;

const memberRef = z.object({ id: memberId, name: z.string() }) satisfies z.ZodType<MemberRef>;

const nestedList = <T extends z.ZodType>(item: T) =>
  z.object({ entities: z.array(item) }).transform((list) => list.entities);

const STORY_WRITE_SCOPES: ReadonlySet<string> = new Set(["write", "story-write", "admin"]);

const canMoveStoriesWith = (scopes: readonly string[] | undefined): boolean =>
  scopes === undefined || scopes.some((scope) => STORY_WRITE_SCOPES.has(scope));

export const WhoamiSchema = z
  .object({
    entity: z.object({
      authorization: z.object({ scopes: z.array(z.string()) }).optional(),
      member: z.object({ id: memberId, name: z.string(), mention_name: z.string() }),
      workspace: z.object({ slug: z.string().min(1) }),
    }),
  })
  .transform(({ entity }): Omit<Workspace, "workflowStates"> => ({
    me: { id: entity.member.id, name: entity.member.name, mentionName: entity.member.mention_name },
    slug: entity.workspace.slug,
    canWrite: canMoveStoriesWith(entity.authorization?.scopes),
  }));

const fieldsOf = (shape: Record<string, unknown>): string => Object.keys(shape).join(",");

const workflowStateFields = {
  id: workflowStateId,
  name: z.string(),
  type: z.enum(["backlog", "unstarted", "started", "done"]),
  position: z.number(),
  workflow: z.object({ id: workflowId, name: z.string() }),
};

export const WORKFLOW_STATE_FIELDS = fieldsOf(workflowStateFields);

const progressOfStateType: Record<"backlog" | "unstarted" | "started" | "done", Progress> = {
  backlog: "unstarted",
  unstarted: "unstarted",
  started: "started",
  done: "done",
};

export const WorkflowStateSchema = z
  .object(workflowStateFields)
  .transform((raw): WorkflowState => ({
    id: raw.id,
    name: raw.name,
    progress: progressOfStateType[raw.type],
    position: raw.position,
    workflow: raw.workflow,
  }));

export type WorkflowStates = ReadonlyMap<WorkflowStateId, WorkflowState>;

const storyRef = z
  .object({ id: storyId, name: z.string(), app_url: z.string() })
  .transform((raw): StoryRef => ({ id: raw.id, name: raw.name, appUrl: raw.app_url }));

const summaryFields = {
  id: storyId,
  name: z.string(),
  story_type: storyType,
  workflow_state: z.object({ id: workflowStateId }),
  estimate: z.number().nullable(),
  owners: nestedList(memberRef),
  epic: z.object({ id: epicId, name: z.string() }).nullable(),
  app_url: z.string(),
  updated_at: timestamp,
  moved_at: timestamp.nullable(),
  created_at: timestamp,
  pull_requests: z.object({ total_items: z.number() }),
  parent_story: storyRef.nullable(),
  sub_task_stories: z.object({ total_items: z.number() }),
  formatted_vcs_branch_name: z.string().nullable(),
  blocked: z.boolean(),
  blocker: z.boolean(),
};

export const SUMMARY_FIELDS = fieldsOf(summaryFields);

const summarySchema = z.object(summaryFields);

export type UnplacedSummary = Omit<StorySummary, "state"> & { stateId: WorkflowStateId };

export const placeInWorkflow = <T extends UnplacedSummary>(
  story: T,
  states: WorkflowStates,
): Omit<T, "stateId"> & { state: WorkflowState } => {
  const state = states.get(story.stateId);
  if (state === undefined) {
    throw new Error(
      `Shortcut sent a story in workflow state ${String(story.stateId)}, which the workflow state list does not include`,
    );
  }
  const { stateId: _stateId, ...placed } = story;
  return { ...placed, state };
};

const toSummary = (raw: z.infer<typeof summarySchema>): UnplacedSummary => ({
  id: raw.id,
  name: raw.name,
  storyType: raw.story_type,
  stateId: raw.workflow_state.id,
  estimate: raw.estimate,
  owners: raw.owners,
  epic: raw.epic,
  appUrl: raw.app_url,
  branchName: raw.formatted_vcs_branch_name,
  updatedAt: raw.updated_at,
  movedAt: raw.moved_at ?? raw.created_at,
  pullRequestCount: raw.pull_requests.total_items,
  parent: raw.parent_story,
  subTaskCount: raw.sub_task_stories.total_items,
  blocked: raw.blocked,
  blocker: raw.blocker,
});

export const StorySummarySchema = summarySchema.transform(toSummary);

const detailFields = {
  ...summaryFields,
  description: z.string(),
  labels: nestedList(z.object({ name: z.string() })),
  checklist_items: z.object({ total_items: z.number() }),
};

export const DETAIL_FIELDS = fieldsOf(detailFields);

type StoryBody = Omit<StoryDetail, "comments" | "subTasks" | "checklist" | "state"> &
  UnplacedSummary & { checklistItemCount: number };

export const StoryBodySchema = z.object(detailFields).transform((raw): StoryBody => ({
  ...toSummary(raw),
  description: raw.description,
  labels: raw.labels.map((label) => label.name),
  checklistItemCount: raw.checklist_items.total_items,
}));

const checklistItemFields = {
  id: z.number(),
  description: z.string(),
  completed: z.boolean(),
  position: z.number(),
};

export const CHECKLIST_ITEM_FIELDS = fieldsOf(checklistItemFields);

export const ChecklistItemSchema = z.object(checklistItemFields);

export const inPositionOrder = (
  items: readonly z.infer<typeof ChecklistItemSchema>[],
): ChecklistItem[] =>
  items
    .toSorted((a, b) => a.position - b.position)
    .map(({ id, description, completed }) => ({ id, description, completed }));

const commentFields = {
  deleted: z.literal(false),
  id: z.number().nullable(),
  author: memberRef.nullable(),
  text: z.string().nullable(),
  created_at: timestamp,
};

export const COMMENT_FIELDS = fieldsOf(commentFields);

export const StoryCommentSchema = z
  .discriminatedUnion("deleted", [z.object({ deleted: z.literal(true) }), z.object(commentFields)])
  .transform((raw): StoryComment | null =>
    raw.deleted || raw.id === null
      ? null
      : { id: raw.id, author: raw.author, text: raw.text ?? "", createdAt: raw.created_at },
  );

const GITHUB_PULL_REQUEST_URL = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)\/?$/;

export const gitHubPullRequestRef = (url: string): PullRequestRef | null => {
  const [, owner, repo, number] = GITHUB_PULL_REQUEST_URL.exec(url) ?? [];
  if (owner === undefined || repo === undefined || number === undefined) return null;
  return { owner, repo, number: Number(number) };
};

const pullRequestFields = {
  id: pullRequestId,
  title: z.string(),
  closed: z.boolean(),
  draft: z.boolean(),
  external_url: z.string(),
};

export const PULL_REQUEST_FIELDS = fieldsOf(pullRequestFields);

export const LinkedPullRequestSchema = z
  .object(pullRequestFields)
  .transform((raw): LinkedPullRequest => ({
    id: raw.id,
    title: raw.title,
    url: raw.external_url,
    closed: raw.closed,
    draft: raw.draft,
    github: gitHubPullRequestRef(raw.external_url),
  }));
