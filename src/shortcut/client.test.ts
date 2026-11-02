import { expect, test } from "bun:test";
import { createShortcutClient } from "./client.ts";
import { epicId, memberId, storyId, workflowStateId } from "./schemas.ts";
import { resolveToken, type ApiToken } from "./token.ts";

const API = "https://api.app.shortcut.com";
const RAW_TOKEN = "sct_r_acme_s3cr3tvalue";
const ME = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";
const QUERY = "owner:kurt !is:done secret-project";
const meRef = { id: memberId.parse(ME), name: "Kurt Schrader" };
const samRef = { id: memberId.parse(SAM), name: "Sam" };

const token = (): ApiToken => {
  const result = resolveToken({
    env: { SHORTCUT_API_TOKEN: RAW_TOKEN },
    readConfigFile: () => null,
  });
  if (!result.ok) throw new Error("fixture token must be v4-shaped");
  return result.token;
};

const memberSlim = (id: string, name: string) => ({
  entity_type: "member",
  id,
  name,
  uri: `${API}/api/v4/acme/members/${id}`,
});

const nested = <T>(entities: T[], path: string) => ({
  current_items: entities.length,
  entities,
  list_url: `${API}/api/v4/acme/${path}`,
  total_items: entities.length,
});

const whoami = {
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

const storyJson = (id: number, overrides: Record<string, unknown> = {}) => ({
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
  ...overrides,
});

const inProgress = {
  entity_type: "workflow-state",
  id: 500000003,
  name: "In Progress",
  uri: `${API}/api/v4/acme/workflow-states/500000003`,
  workflow_name: "Engineering",
};

const workflowStates = [
  { entity_type: "workflow-state", id: 500000002, position: 4 },
  { entity_type: "workflow-state", id: 500000003, position: 5 },
];

const page = (entities: unknown[], next: string | null, total: number) => ({
  $schema: `${API}/api/v4/schemas/StoryEntityListWrapper`,
  entities,
  current_items: entities.length,
  total_items: total,
  next_page_url: next,
});

const commentJson = (id: number | null, author: string | null, text: string | null) => ({
  entity_type: "story-comment",
  id,
  author: author === null ? null : memberSlim(author, author === ME ? "Kurt Schrader" : "Sam"),
  text,
  created_at: "2026-10-02T09:00:00Z",
  deleted: false,
});

type Call = { url: URL; authorization: string | null };
type Route = (url: URL) => Response | undefined;

const stub = (...routes: Route[]) => {
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

const at =
  (path: string, body: () => Response, cursor: string | null = null): Route =>
  (url) =>
    url.pathname === path && url.searchParams.get("cursor") === cursor ? body() : undefined;

const json = (body: unknown) => () => Response.json(body);

const whoamiRoute = at("/api/v4/whoami", json(whoami));

const workflowStatesRoute: Route = (url) =>
  url.pathname === "/api/v4/acme/workflow-states"
    ? Response.json(page(workflowStates, null, workflowStates.length))
    : undefined;

const rejection = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected the promise to reject with an Error");
};

test("loadWorkspace returns me and the workspace slug, authenticating with the bearer token", async () => {
  const { client, calls } = stub(whoamiRoute);
  expect(await client.loadWorkspace()).toEqual({
    me: { ...meRef, mentionName: "kurt" },
    slug: "acme",
  });
  expect(calls.map((call) => [call.url.origin, call.authorization])).toEqual([
    [API, `Bearer ${RAW_TOKEN}`],
  ]);
});

test("searchStories reads every page and maps embedded names", async () => {
  const { client, calls } = stub(
    whoamiRoute,
    at(
      "/api/v4/acme/stories/search",
      json(
        page(
          [
            storyJson(1, {
              name: "Fix login redirect",
              story_type: "bug",
              workflow_state: inProgress,
              started: true,
              estimate: 3,
              owners: nested(
                [memberSlim(ME, "Kurt Schrader"), memberSlim(SAM, "Sam")],
                "stories/1/owners",
              ),
              epic: {
                entity_type: "epic",
                id: 90,
                name: "Auth hardening",
                app_url: "https://app.shortcut.com/acme/epic/90",
                uri: `${API}/api/v4/acme/epics/90`,
              },
            }),
            storyJson(2),
          ],
          `${API}/api/v4/acme/stories/search?cursor=page-2`,
          3,
        ),
      ),
    ),
    at(
      "/api/v4/acme/stories/search",
      json(page([storyJson(3, { completed: true, started: true })], null, 3)),
      "page-2",
    ),
  );

  const stories = await client.searchStories(QUERY);

  expect(stories.map((story) => story.name)).toEqual(["Fix login redirect", "Story 2", "Story 3"]);
  expect(stories[0]).toEqual({
    id: storyId.parse(1),
    name: "Fix login redirect",
    storyType: "bug",
    state: {
      id: workflowStateId.parse(500000003),
      name: "In Progress",
      workflowName: "Engineering",
      progress: "started",
      position: 5,
    },
    estimate: 3,
    owners: [meRef, samRef],
    epic: { id: epicId.parse(90), name: "Auth hardening" },
    appUrl: "https://app.shortcut.com/acme/story/1",
    updatedAt: new Date("2026-10-30T12:30:00.123Z"),
  });
  expect(stories[1]?.state.progress).toBe("unstarted");
  expect(stories[1]?.epic).toBeNull();
  expect(stories[1]?.estimate).toBeNull();
  expect(stories[2]?.state.progress).toBe("done");

  const first = calls[1]?.url.searchParams;
  expect(first?.get("query")).toBe(QUERY);
  expect(first?.get("limit")).toBe("100");
  expect(first?.get("fields")?.split(",")).toContain("workflow_state");
  expect(calls.map((call) => call.url.pathname)).toEqual([
    "/api/v4/whoami",
    "/api/v4/acme/stories/search",
    "/api/v4/acme/stories/search",
    "/api/v4/acme/workflow-states",
  ]);
});

const searchReturning = (...stories: unknown[]) =>
  at("/api/v4/acme/stories/search", json(page(stories, null, stories.length)));

const statesListing = (...lists: (typeof workflowStates)[]): Route => {
  let served = 0;
  return (url) => {
    if (url.pathname !== "/api/v4/acme/workflow-states") return undefined;
    const list = lists[Math.min(served, lists.length - 1)] ?? [];
    served += 1;
    return Response.json(page(list, null, list.length));
  };
};

const workflowStateCalls = (calls: readonly Call[]) =>
  calls.filter((call) => call.url.pathname === "/api/v4/acme/workflow-states").length;

test("workflow state positions are loaded once and reused across searches", async () => {
  const { client, calls } = stub(whoamiRoute, searchReturning(storyJson(1)));
  await client.searchStories(QUERY);
  const [story] = await client.searchStories(QUERY);
  expect(story?.state.position).toBe(4);
  expect(workflowStateCalls(calls)).toBe(1);
});

test("a story in a state missing from the cached positions reloads them", async () => {
  const withoutInProgress = workflowStates.filter((state) => state.id !== 500000003);
  const { client, calls } = stub(
    whoamiRoute,
    statesListing(withoutInProgress, workflowStates),
    at(
      "/api/v4/acme/stories/search",
      json(
        page([storyJson(1), storyJson(2, { workflow_state: inProgress, started: true })], null, 2),
      ),
    ),
  );
  const stories = await client.searchStories(QUERY);
  expect(stories.map((story) => story.state.position)).toEqual([4, 5]);
  expect(workflowStateCalls(calls)).toBe(2);
});

test("a story whose state Shortcut does not list rejects naming the state", async () => {
  const { client } = stub(whoamiRoute, statesListing([]), searchReturning(storyJson(1)));
  const error = await rejection(client.searchStories(QUERY));
  expect(error.message).toContain("workflow state 500000002");
});

const endless: Route = (url) => {
  if (url.pathname !== "/api/v4/acme/stories/search") return undefined;
  const pageNumber = Number(url.searchParams.get("cursor") ?? "0");
  const stories = Array.from({ length: 100 }, (_, i) => storyJson(pageNumber * 100 + i + 1));
  return Response.json(
    page(stories, `${API}/api/v4/acme/stories/search?cursor=${pageNumber + 1}`, 900),
  );
};

test("searchStories stops at 500 stories without fetching further pages", async () => {
  const { client, calls } = stub(whoamiRoute, endless);
  const stories = await client.searchStories(QUERY);
  expect(stories.length).toBe(500);
  expect(stories.at(-1)?.id).toBe(storyId.parse(500));
  expect(calls.filter((call) => call.url.pathname.endsWith("/search")).length).toBe(5);
});

test("getStory combines the story with every page of comments, dropping deleted ones", async () => {
  const comments = "/api/v4/acme/stories/42/comments";
  const { client } = stub(
    whoamiRoute,
    at(
      "/api/v4/acme/stories/42",
      json({
        $schema: `${API}/api/v4/schemas/StoryEntityWrapper`,
        entity: storyJson(42, {
          description: "Users land on a blank page.",
          labels: nested(
            [
              { entity_type: "label", id: 1, name: "auth" },
              { entity_type: "label", id: 2, name: "urgent" },
            ],
            "stories/42/labels",
          ),
        }),
      }),
    ),
    at(
      comments,
      json(
        page(
          [
            commentJson(1, SAM, "Repro'd."),
            { ...commentJson(null, ME, null), deleted: true },
            commentJson(null, ME, "half-written"),
          ],
          `${API}${comments}?cursor=c2`,
          4,
        ),
      ),
    ),
    at(comments, json(page([commentJson(3, null, null)], null, 4)), "c2"),
  );

  const story = await client.getStory(storyId.parse(42));

  expect(story.name).toBe("Story 42");
  expect(story.description).toBe("Users land on a blank page.");
  expect(story.labels).toEqual(["auth", "urgent"]);
  expect(story.comments).toEqual([
    {
      id: 1,
      author: samRef,
      text: "Repro'd.",
      createdAt: new Date("2026-10-02T09:00:00Z"),
    },
    { id: 3, author: null, text: "", createdAt: new Date("2026-10-02T09:00:00Z") },
  ]);
});

test("an API failure names method, path, status and tag but never the token or query", async () => {
  const { client } = stub(
    whoamiRoute,
    at("/api/v4/acme/stories/search", () =>
      Response.json(
        { message: `Bad query ${QUERY} with ${RAW_TOKEN}`, tag: "invalid_query" },
        { status: 400 },
      ),
    ),
  );
  const { message } = await rejection(client.searchStories(QUERY));
  expect(message).toBe("Shortcut API 400 for GET /api/v4/acme/stories/search (invalid_query)");
});

test("an unknown story rejects with a 404 naming the story path", async () => {
  const { client } = stub(whoamiRoute);
  const { message } = await rejection(client.getStory(storyId.parse(7)));
  expect(message).toContain("404");
  expect(message).toContain("/api/v4/acme/stories/7");
});

test("a story missing a requested field rejects with a message naming the field", async () => {
  const { epic: _epic, ...withoutEpic } = storyJson(5);
  const { client } = stub(
    whoamiRoute,
    at("/api/v4/acme/stories/search", json(page([withoutEpic], null, 1))),
  );
  const { message } = await rejection(client.searchStories(QUERY));
  expect(message).toStartWith("Shortcut sent an unexpected response");
  expect(message).toContain("epic");
});

test("a failed workspace load is retried on the next call", async () => {
  let whoamiCalls = 0;
  const flaky: Route = (url) => {
    if (url.pathname !== "/api/v4/whoami") return undefined;
    whoamiCalls += 1;
    return whoamiCalls === 1
      ? Response.json({ message: "Unavailable" }, { status: 503 })
      : Response.json(whoami);
  };
  const { client } = stub(flaky);
  expect((await rejection(client.loadWorkspace())).message).toBe(
    "Shortcut API 503 for GET /api/v4/whoami",
  );
  expect((await client.loadWorkspace()).slug).toBe("acme");
});
