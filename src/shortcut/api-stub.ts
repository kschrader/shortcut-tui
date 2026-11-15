import { createShortcutClient } from "./client.ts";
import { memberId } from "./schemas.ts";
import { resolveToken, type ApiToken } from "./token.ts";

export const API = "https://api.app.shortcut.com";
export const RAW_TOKEN = "sct_r_acme_s3cr3tvalue";
export const ME = "11111111-1111-4111-8111-111111111111";
export const SAM = "22222222-2222-4222-8222-222222222222";
export const QUERY = "owner:kurt !is:done secret-project";
export const meRef = { id: memberId.parse(ME), name: "Kurt Schrader" };
export const samRef = { id: memberId.parse(SAM), name: "Sam" };

export const token = (): ApiToken => {
  const result = resolveToken({
    env: { SHORTCUT_API_TOKEN: RAW_TOKEN },
    readConfigFile: () => null,
  });
  if (!result.ok) throw new Error("fixture token must be v4-shaped");
  return result.token;
};

export const memberSlim = (id: string, name: string) => ({
  entity_type: "member",
  id,
  name,
  uri: `${API}/api/v4/acme/members/${id}`,
});

export const nested = <T>(entities: T[], path: string) => ({
  current_items: entities.length,
  entities,
  list_url: `${API}/api/v4/acme/${path}`,
  total_items: entities.length,
});

export const whoami = {
  $schema: `${API}/api/v4/schemas/WhoamiEntityWrapper`,
  entity: {
    entity_type: "whoami",
    authorization: { scopes: ["read"] },
    member: {
      ...memberSlim(ME, "Kurt Schrader"),
      mention_name: "kurt",
      role: "admin",
      disabled: false,
      agent: null,
    },
    workspace: {
      entity_type: "workspace",
      id: "33333333-3333-4333-8333-333333333333",
      name: "Acme",
      slug: "acme",
      app_url: "https://app.shortcut.com/acme",
    },
  },
};

export const whoamiReadWrite = {
  ...whoami,
  entity: { ...whoami.entity, authorization: { scopes: ["read", "write"] } },
};

const stateSlim = (id: number, name: string) => ({
  entity_type: "workflow-state:slim",
  id,
  name,
  uri: `${API}/api/v4/acme/workflow-states/${id}`,
  workflow_name: "Engineering",
});

export const storyJson = (id: number, overrides: Record<string, unknown> = {}) => ({
  entity_type: "story",
  id,
  name: `Story ${id}`,
  story_type: "feature",
  workflow_state: stateSlim(500000002, "Ready for Development"),
  started: false,
  completed: false,
  estimate: null,
  owners: nested([memberSlim(ME, "Kurt Schrader")], `stories/${id}/owners`),
  epic: null,
  app_url: `https://app.shortcut.com/acme/story/${id}`,
  updated_at: "2026-10-30T12:30:00.123Z",
  moved_at: "2026-10-29T09:15:00Z",
  created_at: "2026-10-20T08:00:00Z",
  pull_requests: nested([], `stories/${id}/pull-requests`),
  parent_story: null,
  sub_task_stories: nested([], `stories/${id}/sub-task-stories`),
  checklist_items: nested([], `stories/${id}/checklist-items`),
  formatted_vcs_branch_name: `kurt/sc-${id}/story-${id}`,
  blocked: false,
  blocker: false,
  ...overrides,
});

export const inProgress = stateSlim(500000003, "In Progress");
export const done = stateSlim(500000005, "Done");

export const ENGINEERING_WORKFLOW_ID = 1488;

const workflowSlim = {
  entity_type: "workflow:slim",
  id: ENGINEERING_WORKFLOW_ID,
  name: "Engineering",
  uri: `${API}/api/v4/acme/workflows/${ENGINEERING_WORKFLOW_ID}`,
};

export const workflowStates = [
  {
    entity_type: "workflow-state",
    id: 500000002,
    name: "Ready for Development",
    type: "unstarted",
    position: 4,
    workflow: workflowSlim,
  },
  {
    entity_type: "workflow-state",
    id: 500000003,
    name: "In Progress",
    type: "started",
    position: 5,
    workflow: workflowSlim,
  },
  {
    entity_type: "workflow-state",
    id: 500000005,
    name: "Done",
    type: "done",
    position: 7,
    workflow: workflowSlim,
  },
];

export const page = (entities: unknown[], next: string | null, total: number) => ({
  $schema: `${API}/api/v4/schemas/StoryEntityListWrapper`,
  entities,
  current_items: entities.length,
  total_items: total,
  next_page_url: next,
});

export const commentJson = (id: number | null, author: string | null, text: string | null) => ({
  entity_type: "story-comment",
  id,
  author: author === null ? null : memberSlim(author, author === ME ? "Kurt Schrader" : "Sam"),
  text,
  created_at: "2026-10-02T09:00:00Z",
  deleted: false,
});

export type Call = { url: URL; method: string; authorization: string | null; body: unknown };
export type Route = (url: URL, method: string) => Response | undefined;

export const stub = (...routes: Route[]) => {
  const calls: Call[] = [];
  const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const text = await request.text();
    const body: unknown = text === "" ? null : JSON.parse(text);
    calls.push({
      url,
      method: request.method,
      authorization: request.headers.get("Authorization"),
      body,
    });
    for (const route of [...routes, workflowStatesRoute]) {
      const response = route(url, request.method);
      if (response !== undefined) return response;
    }
    return Response.json({ message: "No such route", tag: "not_found" }, { status: 404 });
  };
  const fetch = Object.assign(handler, { preconnect: () => undefined });
  return { calls, client: createShortcutClient({ token: token(), fetch }) };
};

export const at =
  (path: string, body: () => Response, cursor: string | null = null): Route =>
  (url, method) =>
    method === "GET" && url.pathname === path && url.searchParams.get("cursor") === cursor
      ? body()
      : undefined;

export const patching =
  (path: string, body: () => Response): Route =>
  (url, method) =>
    method === "PATCH" && url.pathname === path ? body() : undefined;

export const json = (body: unknown) => () => Response.json(body);

export const storyEntity = (entity: unknown) =>
  json({ $schema: `${API}/api/v4/schemas/StoryEntityWrapper`, entity });

export const whoamiRoute = at("/api/v4/whoami", json(whoami));

export const workflowStatesRoute: Route = (url, method) =>
  method === "GET" && url.pathname === "/api/v4/acme/workflow-states"
    ? Response.json(page(workflowStates, null, workflowStates.length))
    : undefined;

export const rejection = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected the promise to reject with an Error");
};
