import { z } from "zod";
import type {
  EpicId,
  Member,
  MemberId,
  StoryComment,
  StoryDetail,
  StoryId,
  StorySummary,
  StoryType,
  WorkflowState,
  WorkflowStateId,
  WorkflowStateKind,
} from "./types.ts";

export const storyId = z.custom<StoryId>((value) => typeof value === "number");
export const memberId = z.custom<MemberId>((value) => typeof value === "string");
export const workflowStateId = z.custom<WorkflowStateId>((value) => typeof value === "number");
export const epicId = z.custom<EpicId>((value) => typeof value === "number");

const storyType = z.enum(["feature", "bug", "chore"]) satisfies z.ZodType<StoryType>;

const stateKinds: Record<string, WorkflowStateKind> = {
  backlog: "unstarted",
  unstarted: "unstarted",
  started: "started",
  done: "done",
};

const stateKind = z.string().transform((type, ctx): WorkflowStateKind => {
  const kind = stateKinds[type];
  if (kind === undefined) {
    ctx.issues.push({
      code: "custom",
      message: `unknown workflow state type "${type}"`,
      input: type,
    });
    return z.NEVER;
  }
  return kind;
});

export const MeSchema = z
  .object({ id: memberId, mention_name: z.string(), name: z.string() })
  .transform(({ id, mention_name, name }): Member => ({ id, name, mentionName: mention_name }));

export const MembersSchema = z.array(
  z
    .object({
      id: memberId,
      profile: z.object({ name: z.string().nullable(), mention_name: z.string() }),
    })
    .transform(({ id, profile }): Member => ({
      id,
      name: profile.name ?? profile.mention_name,
      mentionName: profile.mention_name,
    })),
);

export const WorkflowsSchema = z
  .array(
    z.object({
      states: z.array(
        z
          .object({ id: workflowStateId, name: z.string(), type: stateKind })
          .transform(({ id, name, type }): WorkflowState => ({ id, name, kind: type })),
      ),
    }),
  )
  .transform((workflows) => workflows.flatMap((workflow) => workflow.states));

const summaryFields = {
  id: storyId,
  name: z.string(),
  story_type: storyType,
  workflow_state_id: workflowStateId,
  estimate: z.number().nullable(),
  owner_ids: z.array(memberId),
  epic_id: epicId.nullable(),
  app_url: z.string(),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date().nullable(),
};

const summarySchema = z.object(summaryFields);

const toSummary = (raw: z.infer<typeof summarySchema>): StorySummary => ({
  id: raw.id,
  name: raw.name,
  storyType: raw.story_type,
  workflowStateId: raw.workflow_state_id,
  estimate: raw.estimate,
  ownerIds: raw.owner_ids,
  epicId: raw.epic_id,
  appUrl: raw.app_url,
  updatedAt: raw.updated_at ?? raw.created_at,
});

const commentSchema = z.object({
  id: z.number(),
  author_id: memberId.nullable(),
  text: z.string().nullable(),
  created_at: z.coerce.date(),
  deleted: z.boolean().optional(),
});

const toComments = (raw: z.infer<typeof commentSchema>[]): StoryComment[] =>
  raw.flatMap((comment) =>
    comment.deleted === true
      ? []
      : [
          {
            id: comment.id,
            authorId: comment.author_id,
            text: comment.text ?? "",
            createdAt: comment.created_at,
          },
        ],
  );

export const StorySummarySchema = summarySchema.transform(toSummary);

export const StoryDetailSchema = z
  .object({
    ...summaryFields,
    description: z.string().nullable(),
    labels: z.array(z.object({ name: z.string() })),
    comments: z.array(commentSchema),
  })
  .transform((raw): StoryDetail => ({
    ...toSummary(raw),
    description: raw.description ?? "",
    labels: raw.labels.map((label) => label.name),
    comments: toComments(raw.comments),
  }));

export const SearchStoriesSchema = z
  .object({ data: z.array(StorySummarySchema) })
  .transform((page) => page.data);
