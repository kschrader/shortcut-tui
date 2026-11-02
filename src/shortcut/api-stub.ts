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

export const storyJson = (id: number, overrides: Record<string, unknown> = {}) => ({
  entity_type: "story",
  id,
  name: `Story ${id}`,
  story_type: "feature",
  workflow_state: {
    entity_type: "workflow-state",
    id: 500000002,
    name: "Ready for Development",
    uri: `${API}/api/v4/acme/workflow-states/500000002`,
    workflow_name: "Engineering",
  },
  started: false,
  completed: false,
  estimate: null,
  owners: nested([memberSlim(ME, "Kurt Schrader")], `stories/${id}/owners`),
  epic: null,
  app_url: `https://app.shortcut.com/acme/story/${id}`,
  updated_at: "2026-10-30T12:30:00.123Z",
  pull_requests: nested([], `stories/${id}/pull-requests`),
  ...overrides,
});

export const inProgress = {
  entity_type: "workflow-state",
  id: 500000003,
  name: "In Progress",
  uri: `${API}/api/v4/acme/workflow-states/500000003`,
  workflow_name: "Engineering",
};

export const workflowStates = [
  { entity_type: "workflow-state", id: 500000002, position: 4 },
  { entity_type: "workflow-state", id: 500000003, position: 5 },
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

export type Call = { url: URL; authorization: string | null };
export type Route = (url: URL) => Response | undefined;

export const stub = (...routes: Route[]) => {
  const calls: Call[] = [];
  const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    calls.push({ url, authorization: new Headers(init?.headers).get("Authorization") });
    for (const route of [...routes, workflowStatesRoute]) {
      const response = route(url);
      if (response !== undefined) return response;
    }
    return Response.json({ message: "No such route", tag: "not_found" }, { status: 404 });
  };
  const fetch = Object.assign(handler, { preconnect: () => undefined });
  return { calls, client: createShortcutClient({ token: token(), fetch }) };
};

export const at =
  (path: string, body: () => Response, cursor: string | null = null): Route =>
  (url) =>
    url.pathname === path && url.searchParams.get("cursor") === cursor ? body() : undefined;

export const json = (body: unknown) => () => Response.json(body);

export const whoamiRoute = at("/api/v4/whoami", json(whoami));

export const workflowStatesRoute: Route = (url) =>
  url.pathname === "/api/v4/acme/workflow-states"
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
