import { z } from "zod";
import type {
  EpicId,
  MemberId,
  MemberRef,
  Progress,
  StoryComment,
  StoryDetail,
  StoryId,
  StorySummary,
  StoryType,
  WorkflowStateId,
  Workspace,
} from "./types.ts";

export const storyId = z.custom<StoryId>((value) => typeof value === "number");
export const memberId = z.custom<MemberId>((value) => typeof value === "string");
export const workflowStateId = z.custom<WorkflowStateId>((value) => typeof value === "number");
export const epicId = z.custom<EpicId>((value) => typeof value === "number");

const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const storyType = z.enum(["feature", "bug", "chore"]) satisfies z.ZodType<StoryType>;

const memberRef = z.object({ id: memberId, name: z.string() }) satisfies z.ZodType<MemberRef>;

const nestedList = <T extends z.ZodType>(item: T) =>
  z.object({ entities: z.array(item) }).transform((list) => list.entities);

const progressOf = (started: boolean, completed: boolean): Progress => {
  if (completed) return "done";
  return started ? "started" : "unstarted";
};

export const WhoamiSchema = z
  .object({
    entity: z.object({
      member: z.object({ id: memberId, name: z.string(), mention_name: z.string() }),
      workspace: z.object({ slug: z.string().min(1) }),
    }),
  })
  .transform(({ entity }): Workspace => ({
    me: { id: entity.member.id, name: entity.member.name, mentionName: entity.member.mention_name },
    slug: entity.workspace.slug,
  }));

export const SUMMARY_FIELDS =
  "id,name,story_type,workflow_state,started,completed,estimate,owners,epic,app_url,updated_at";
export const DETAIL_FIELDS = `${SUMMARY_FIELDS},description,labels`;
export const COMMENT_FIELDS = "id,author,text,created_at,deleted";

const summaryFields = {
  id: storyId,
  name: z.string(),
  story_type: storyType,
  workflow_state: z.object({ id: workflowStateId, name: z.string() }),
  started: z.boolean(),
  completed: z.boolean(),
  estimate: z.number().nullable(),
  owners: nestedList(memberRef),
  epic: z.object({ id: epicId, name: z.string() }).nullable(),
  app_url: z.string(),
  updated_at: timestamp,
};

const summarySchema = z.object(summaryFields);

const toSummary = (raw: z.infer<typeof summarySchema>): StorySummary => ({
  id: raw.id,
  name: raw.name,
  storyType: raw.story_type,
  state: {
    id: raw.workflow_state.id,
    name: raw.workflow_state.name,
    progress: progressOf(raw.started, raw.completed),
  },
  estimate: raw.estimate,
  owners: raw.owners,
  epic: raw.epic,
  appUrl: raw.app_url,
  updatedAt: raw.updated_at,
});

export const StorySummarySchema = summarySchema.transform(toSummary);

export const StoryBodySchema = z
  .object({
    ...summaryFields,
    description: z.string(),
    labels: nestedList(z.object({ name: z.string() })),
  })
  .transform((raw): Omit<StoryDetail, "comments"> => ({
    ...toSummary(raw),
    description: raw.description,
    labels: raw.labels.map((label) => label.name),
  }));

export const StoryCommentSchema = z
  .discriminatedUnion("deleted", [
    z.object({ deleted: z.literal(true) }),
    z.object({
      deleted: z.literal(false),
      id: z.number().nullable(),
      author: memberRef.nullable(),
      text: z.string().nullable(),
      created_at: timestamp,
    }),
  ])
  .transform((raw): StoryComment | null =>
    raw.deleted || raw.id === null
      ? null
      : { id: raw.id, author: raw.author, text: raw.text ?? "", createdAt: raw.created_at },
  );
