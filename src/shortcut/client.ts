import {
  ShortcutV4Client,
  summarizeShortcutV4Error,
  type ShortcutWorkspaceApi,
} from "@shortcut/client/v4";
import { z } from "zod";
import {
  COMMENT_FIELDS,
  DETAIL_FIELDS,
  StoryBodySchema,
  StoryCommentSchema,
  placeInWorkflow,
  StorySummarySchema,
  SUMMARY_FIELDS,
  WhoamiSchema,
  WORKFLOW_STATE_FIELDS,
  WorkflowStatePositionSchema,
  type StatePositions,
  type UnplacedSummary,
} from "./schemas.ts";
import type { ApiToken } from "./token.ts";
import type { ShortcutClient, StoryComment, StoryId, WorkflowStateId, Workspace } from "./types.ts";

export type ClientOptions = {
  token: ApiToken;
  baseUrl?: string;
  fetch?: typeof fetch;
};

const SEARCH_LIMIT = 500;
const PAGE_SIZE = 100;

type Session = {
  workspace: Workspace;
  api: ShortcutWorkspaceApi;
  positions: Promise<StatePositions> | null;
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

const attempt = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    throw describeFailure(error);
  }
};

export const createShortcutClient = ({ token, baseUrl, fetch }: ClientOptions): ShortcutClient => {
  const client = new ShortcutV4Client({ token, baseUrl, fetch });
  let session: Promise<Session> | null = null;

  const openSession = async (): Promise<Session> => {
    const workspace = WhoamiSchema.parse(await client.getWhoami());
    return { workspace, api: client.workspace(workspace.slug), positions: null };
  };

  const loadPositions = async (api: ShortcutWorkspaceApi): Promise<StatePositions> => {
    const positions = new Map<WorkflowStateId, number>();
    for await (const raw of client.paginate(
      api.listWorkflowStates({ fields: WORKFLOW_STATE_FIELDS, limit: PAGE_SIZE }),
    )) {
      const state = WorkflowStatePositionSchema.parse(raw);
      positions.set(state.id, state.position);
    }
    return positions;
  };

  const positionsCovering = async (
    current: Session,
    stories: readonly UnplacedSummary[],
  ): Promise<StatePositions> => {
    current.positions ??= loadPositions(current.api);
    const cached = await current.positions;
    if (stories.every((story) => cached.has(story.state.id))) return cached;
    current.positions = loadPositions(current.api);
    return current.positions;
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
        const positions = await positionsCovering(current, stories);
        return stories.map((story) => placeInWorkflow(story, positions));
      }),

    getStory: (id) =>
      attempt(async () => {
        const current = await connect();
        const { api } = current;
        const [{ entity }, comments] = await Promise.all([
          api.getStory(id, { fields: DETAIL_FIELDS }),
          listComments(api, id),
        ]);
        const body = StoryBodySchema.parse(entity);
        const positions = await positionsCovering(current, [body]);
        return { ...placeInWorkflow(body, positions), comments };
      }),
  };
};
