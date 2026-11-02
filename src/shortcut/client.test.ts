import { expect, test } from "bun:test";
import { createShortcutClient, type Fetch } from "./client.ts";
import { memberId, storyId, workflowStateId } from "./schemas.ts";

const TOKEN = "secret-token-123";
const ME = memberId.parse("11111111-1111-4111-8111-111111111111");
const OTHER = memberId.parse("22222222-2222-4222-8222-222222222222");

const storyJson = {
  id: 42,
  name: "Fix login redirect",
  story_type: "bug",
  workflow_state_id: 500000002,
  estimate: 3,
  owner_ids: [ME],
  epic_id: null,
  app_url: "https://app.shortcut.com/acme/story/42",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-30T12:30:00Z",
  position: 1234,
  archived: false,
};

const fullStoryJson = {
  ...storyJson,
  description: "Users land on a blank page.",
  labels: [
    { id: 1, name: "auth" },
    { id: 2, name: "urgent" },
  ],
  comments: [
    {
      id: 1,
      author_id: OTHER,
      text: "Repro'd.",
      created_at: "2026-10-02T09:00:00Z",
      deleted: false,
    },
    { id: 2, author_id: ME, text: "gone", created_at: "2026-10-03T09:00:00Z", deleted: true },
    { id: 3, author_id: null, text: "From an integration", created_at: "2026-10-04T09:00:00Z" },
  ],
};

const routes: Record<string, unknown> = {
  "/api/v3/member": {
    id: ME,
    mention_name: "kurt",
    name: "Kurt",
    workspace2: { url_slug: "acme" },
  },
  "/api/v3/members": [
    {
      id: ME,
      disabled: false,
      profile: { name: "Kurt", mention_name: "kurt", email_address: "k@x.io" },
    },
    { id: OTHER, disabled: false, profile: { name: null, mention_name: "sam" } },
  ],
  "/api/v3/workflows": [
    {
      id: 1,
      name: "Default",
      states: [
        { id: 500000001, name: "Backlog", type: "backlog" },
        { id: 500000002, name: "In Progress", type: "started" },
        { id: 500000003, name: "Done", type: "done" },
      ],
    },
  ],
  "/api/v3/search/stories": { data: [storyJson], next: null, total: 1 },
  "/api/v3/stories/42": fullStoryJson,
};

const rejection = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected the promise to reject with an Error");
};

type Call = { url: URL; headers: Record<string, string> };

const stub = (overrides: Record<string, Response> = {}) => {
  const calls: Call[] = [];
  const fetch: Fetch = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, headers: init.headers });
    const override = overrides[parsed.pathname];
    if (override !== undefined) return override;
    const body = routes[parsed.pathname];
    return body === undefined ? new Response("nope", { status: 404 }) : Response.json(body);
  };
  return { calls, client: createShortcutClient({ token: TOKEN, fetch }) };
};

test("loadWorkspace combines me, members and workflow states", async () => {
  const { client, calls } = stub();
  const workspace = await client.loadWorkspace();

  expect(workspace.me).toEqual({ id: ME, name: "Kurt", mentionName: "kurt" });
  expect(workspace.members.get(OTHER)).toEqual({ id: OTHER, name: "sam", mentionName: "sam" });
  expect([...workspace.workflowStates.values()].map((s) => [s.name, s.kind])).toEqual([
    ["Backlog", "unstarted"],
    ["In Progress", "started"],
    ["Done", "done"],
  ]);
  expect(calls.map((c) => c.url.pathname).toSorted()).toEqual([
    "/api/v3/member",
    "/api/v3/members",
    "/api/v3/workflows",
  ]);
});

test("every request carries the token header and targets the default base url", async () => {
  const { client, calls } = stub();
  await client.loadWorkspace();
  expect(calls.length).toBe(3);
  for (const call of calls) {
    expect(call.headers["Shortcut-Token"]).toBe(TOKEN);
    expect(call.url.origin).toBe("https://api.app.shortcut.com");
  }
});

test("searchStories encodes the query and returns summaries", async () => {
  const { client, calls } = stub();
  const stories = await client.searchStories("owner:kurt !is:done &x=1 é");

  const params = calls[0]?.url.searchParams;
  expect(params?.get("query")).toBe("owner:kurt !is:done &x=1 é");
  expect(params?.get("page_size")).toBe("25");
  expect(params?.get("detail")).toBe("full");
  expect(calls[0]?.url.search).not.toContain("&x=1");
  expect(stories).toEqual([
    {
      id: storyId.parse(42),
      name: "Fix login redirect",
      storyType: "bug",
      workflowStateId: workflowStateId.parse(500000002),
      estimate: 3,
      ownerIds: [ME],
      epicId: null,
      appUrl: "https://app.shortcut.com/acme/story/42",
      updatedAt: new Date("2026-10-30T12:30:00Z"),
    },
  ]);
});

test("getStory returns detail with labels and drops deleted comments", async () => {
  const { client } = stub();
  const story = await client.getStory(storyId.parse(42));

  expect(story.description).toBe("Users land on a blank page.");
  expect(story.labels).toEqual(["auth", "urgent"]);
  expect(story.comments.map((c) => [c.id, c.authorId, c.text])).toEqual([
    [1, OTHER, "Repro'd."],
    [3, null, "From an integration"],
  ]);
  expect(story.comments[0]?.createdAt).toEqual(new Date("2026-10-02T09:00:00Z"));
  expect("position" in story).toBe(false);
});

test("a story that was never updated falls back to its creation time", async () => {
  const { client } = stub({
    "/api/v3/stories/42": Response.json({ ...fullStoryJson, updated_at: null, description: null }),
  });
  const story = await client.getStory(storyId.parse(42));
  expect(story.updatedAt).toEqual(new Date("2026-10-01T10:00:00Z"));
  expect(story.description).toBe("");
});

test("a non-2xx response throws with status and path but never the token", async () => {
  const { client } = stub({ "/api/v3/member": new Response("denied", { status: 401 }) });
  const { message } = await rejection(client.loadWorkspace());
  expect(message).toContain("401");
  expect(message).toContain("/api/v3/member");
  expect(message).not.toContain(TOKEN);
});

test("an unknown story throws a 404 naming the story path", async () => {
  const { client } = stub();
  const { message } = await rejection(client.getStory(storyId.parse(7)));
  expect(message).toMatch(/404.*\/api\/v3\/stories\/7/);
});

test("a payload that does not match the schema is rejected", async () => {
  const { client } = stub({
    "/api/v3/search/stories": Response.json({ data: [{ ...storyJson, story_type: "epic" }] }),
  });
  await rejection(client.searchStories("x"));
});

test("baseUrl overrides the host", async () => {
  const calls: string[] = [];
  const client = createShortcutClient({
    token: TOKEN,
    baseUrl: "http://localhost:9999",
    fetch: async (url) => {
      calls.push(url);
      return Response.json({ data: [] });
    },
  });
  await client.searchStories("x");
  expect(calls[0]?.startsWith("http://localhost:9999/api/v3/search/stories?")).toBe(true);
});
