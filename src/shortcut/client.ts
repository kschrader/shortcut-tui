import {
  ShortcutV4Client,
  summarizeShortcutV4Error,
  type ShortcutWorkspaceApi,
} from "@shortcut/client/v4";
import { z } from "zod";
import {
  CHECKLIST_ITEM_FIELDS,
  ChecklistItemSchema,
  COMMENT_FIELDS,
  DETAIL_FIELDS,
  inPositionOrder,
  LinkedPullRequestSchema,
  StoryBodySchema,
  StoryCommentSchema,
  placeInWorkflow,
  PULL_REQUEST_FIELDS,
  StorySummarySchema,
  SUMMARY_FIELDS,
  WhoamiSchema,
  WORKFLOW_STATE_FIELDS,
  WorkflowStateSchema,
  type UnplacedSummary,
  type WorkflowStates,
} from "./schemas.ts";
import type { ApiToken } from "./token.ts";
import type {
  LinkedPullRequest,
  ShortcutClient,
  StoryComment,
  StoryId,
  WorkflowState,
  Workspace,
} from "./types.ts";

export type ClientOptions = {
  token: ApiToken;
  baseUrl?: string;
  fetch?: typeof fetch;
};

const SEARCH_LIMIT = 500;
const PAGE_SIZE = 100;

export const READ_ONLY_TOKEN_HINT =
  "this token is read-only. Moving stories needs a read-write sct_ token from https://app.shortcut.com/settings/account/api-tokens";

type Session = {
  workspace: Workspace;
  api: ShortcutWorkspaceApi;
  states: Promise<WorkflowStates>;
};

const describeFailure = (error: unknown): Error => {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    return new Error(`Shortcut sent an unexpected response (${issues.join("; ")})`);
  }
  const summary = summarizeShortcutV4Error(error);
  if (summary === null)
    return error instanceof Error ? error : new Error("Shortcut request failed");
  const tag = summary.tag === undefined ? "" : ` (${summary.tag})`;
  return new Error(`Shortcut API ${summary.status} for ${summary.method} ${summary.path}${tag}`);
};

const describeMoveFailure = (error: unknown): Error =>
  summarizeShortcutV4Error(error)?.status === 403
    ? new Error(`Shortcut refused the move (403): ${READ_ONLY_TOKEN_HINT}`)
    : describeFailure(error);

const attempt = async <T>(run: () => Promise<T>, describe = describeFailure): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw describe(error);
  }
};

const byId = (states: readonly WorkflowState[]): WorkflowStates =>
  new Map(states.map((state) => [state.id, state]));

export const createShortcutClient = ({ token, baseUrl, fetch }: ClientOptions): ShortcutClient => {
  const client = new ShortcutV4Client({ token, baseUrl, fetch });
  let session: Promise<Session> | null = null;

  const loadStates = async (api: ShortcutWorkspaceApi): Promise<WorkflowState[]> => {
    const states: WorkflowState[] = [];
    for await (const raw of client.paginate(
      api.listWorkflowStates({ fields: WORKFLOW_STATE_FIELDS, limit: PAGE_SIZE }),
    )) {
      states.push(WorkflowStateSchema.parse(raw));
    }
    return states;
  };

  const openSession = async (): Promise<Session> => {
    const whoami = WhoamiSchema.parse(await client.getWhoami());
    const api = client.workspace(whoami.slug);
    const workflowStates = await loadStates(api);
    return {
      workspace: { ...whoami, workflowStates },
      api,
      states: Promise.resolve(byId(workflowStates)),
    };
  };

  const statesCovering = async (
    current: Session,
    stories: readonly UnplacedSummary[],
  ): Promise<WorkflowStates> => {
    const cached = await current.states;
    if (stories.every((story) => cached.has(story.stateId))) return cached;
    current.states = loadStates(current.api).then(byId);
    return current.states;
  };

  const connect = async (): Promise<Session> => {
    const pending = session ?? openSession();
    session = pending;
    try {
      return await pending;
    } catch (error) {
      if (session === pending) session = null;
      throw error;
    }
  };

  const listComments = async (api: ShortcutWorkspaceApi, id: StoryId) => {
    const comments: StoryComment[] = [];
    for await (const raw of client.paginate(
      api.listStoryComments(id, { fields: COMMENT_FIELDS, limit: PAGE_SIZE }),
    )) {
      const comment = StoryCommentSchema.parse(raw);
      if (comment !== null) comments.push(comment);
    }
    return comments;
  };

  const listSubTasks = async (api: ShortcutWorkspaceApi, id: StoryId) => {
    const subTasks: UnplacedSummary[] = [];
    for await (const raw of client.paginate(
      api.listStorySubTaskStories(id, { fields: SUMMARY_FIELDS, limit: PAGE_SIZE }),
    )) {
      subTasks.push(StorySummarySchema.parse(raw));
    }
    return subTasks;
  };

  const listChecklist = async (api: ShortcutWorkspaceApi, id: StoryId) => {
    const items: z.infer<typeof ChecklistItemSchema>[] = [];
    for await (const raw of client.paginate(
      api.listStoryChecklistItems(id, { fields: CHECKLIST_ITEM_FIELDS, limit: PAGE_SIZE }),
    )) {
      items.push(ChecklistItemSchema.parse(raw));
    }
    return inPositionOrder(items);
  };

  const loadBodyAndLists = async (api: ShortcutWorkspaceApi, id: StoryId) => {
    const { entity } = await api.getStory(id, { fields: DETAIL_FIELDS });
    const { checklistItemCount, ...body } = StoryBodySchema.parse(entity);
    const [subTasks, checklist] = await Promise.all([
      body.subTaskCount > 0 ? listSubTasks(api, id) : [],
      checklistItemCount > 0 ? listChecklist(api, id) : [],
    ]);
    return { body, subTasks, checklist };
  };

  return {
    loadWorkspace: () => attempt(async () => (await connect()).workspace),

    searchStories: (query) =>
      attempt(async () => {
        const current = await connect();
        const { api } = current;
        const stories: UnplacedSummary[] = [];
        for await (const raw of client.paginate(
          api.searchStories({ query, limit: PAGE_SIZE, fields: SUMMARY_FIELDS }),
        )) {
          stories.push(StorySummarySchema.parse(raw));
          if (stories.length === SEARCH_LIMIT) break;
        }
        const states = await statesCovering(current, stories);
        return stories.map((story) => placeInWorkflow(story, states));
      }),

    getStory: (id) =>
      attempt(async () => {
        const current = await connect();
        const { api } = current;
        const [{ body, subTasks, checklist }, comments] = await Promise.all([
          loadBodyAndLists(api, id),
          listComments(api, id),
        ]);
        const states = await statesCovering(current, [body, ...subTasks]);
        return {
          ...placeInWorkflow(body, states),
          comments,
          subTasks: subTasks.map((subTask) => placeInWorkflow(subTask, states)),
          checklist,
        };
      }),

    listPullRequests: (id) =>
      attempt(async () => {
        const { api } = await connect();
        const pullRequests: LinkedPullRequest[] = [];
        for await (const raw of client.paginate(
          api.listStoryPullRequests(id, { fields: PULL_REQUEST_FIELDS, limit: PAGE_SIZE }),
        )) {
          pullRequests.push(LinkedPullRequestSchema.parse(raw));
        }
        return pullRequests;
      }),

    moveStory: (id, stateId) =>
      attempt(async () => {
        const current = await connect();
        const { entity } = await current.api.updateStory(
          id,
          { workflow_state_id: stateId },
          { fields: SUMMARY_FIELDS },
        );
        const story = StorySummarySchema.parse(entity);
        return placeInWorkflow(story, await statesCovering(current, [story]));
      }, describeMoveFailure),
  };
};
