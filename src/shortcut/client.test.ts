import { expect, test } from "bun:test";
import {
  API,
  RAW_TOKEN,
  ME,
  SAM,
  QUERY,
  meRef,
  samRef,
  memberSlim,
  nested,
  whoami,
  storyJson,
  inProgress,
  workflowStates,
  page,
  commentJson,
  type Call,
  type Route,
  stub,
  at,
  json,
  whoamiRoute,
  rejection,
} from "./api-stub.ts";
import { epicId, storyId, workflowStateId } from "./schemas.ts";

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
              pull_requests: nested(
                [
                  { entity_type: "pull-request:slim", id: 501, name: "Fix redirect" },
                  { entity_type: "pull-request:slim", id: 502, name: "Add test" },
                ],
                "stories/1/pull-requests",
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
    pullRequestCount: 2,
  });
  expect(stories[1]?.state.progress).toBe("unstarted");
  expect(stories[1]?.epic).toBeNull();
  expect(stories[1]?.estimate).toBeNull();
  expect(stories[2]?.state.progress).toBe("done");

  const first = calls[1]?.url.searchParams;
  expect(first?.get("query")).toBe(QUERY);
  expect(first?.get("limit")).toBe("100");
  expect(first?.get("fields")?.split(",")).toContain("workflow_state");
  expect(first?.get("fields")?.split(",")).toContain("pull_requests");
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
