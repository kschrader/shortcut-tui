import { expect, test } from "bun:test";
import {
  API,
  at,
  done,
  inProgress,
  json,
  nested,
  page,
  patching,
  rejection,
  storyJson,
  stub,
  whoamiReadWrite,
  whoamiRoute,
  workflowStates,
  type Route,
} from "./api-stub.ts";
import { storyId, workflowStateId } from "./schemas.ts";

const STORY = "/api/v4/acme/stories/42";
const CHILDREN = `${STORY}/sub-task-stories`;

const parentRef = {
  entity_type: "story:slim",
  id: 7,
  name: "Onboarding redesign",
  app_url: "https://app.shortcut.com/acme/story/7",
  uri: `${API}/api/v4/acme/stories/7`,
};

const subTaskList = (total: number, shown: number) => ({
  ...nested(
    Array.from({ length: shown }, (_, index) => ({ id: 100 + index, name: `Slim ${index}` })),
    "stories/42/sub-task-stories",
  ),
  total_items: total,
});

const story42 = (overrides: Record<string, unknown> = {}) =>
  at(
    STORY,
    json({
      $schema: `${API}/api/v4/schemas/StoryEntityWrapper`,
      entity: storyJson(42, {
        description: "",
        labels: nested([], "stories/42/labels"),
        ...overrides,
      }),
    }),
  );

const noComments = at(`${STORY}/comments`, json(page([], null, 0)));

const callsTo = (calls: readonly { url: URL }[], path: string) =>
  calls.filter((call) => call.url.pathname === path);

test("a search reads each story's parent and its sub-task count from total_items, which can exceed the embedded list", async () => {
  const { client, calls } = stub(
    whoamiRoute,
    at(
      "/api/v4/acme/stories/search",
      json(
        page(
          [
            storyJson(1, { parent_story: parentRef }),
            storyJson(2, { sub_task_stories: subTaskList(5, 2) }),
            storyJson(3),
          ],
          null,
          3,
        ),
      ),
    ),
  );

  const stories = await client.searchStories("owner:kurt");

  expect(stories.map(({ parent, subTaskCount }) => ({ parent, subTaskCount }))).toEqual([
    {
      parent: {
        id: storyId.parse(7),
        name: "Onboarding redesign",
        appUrl: "https://app.shortcut.com/acme/story/7",
      },
      subTaskCount: 0,
    },
    { parent: null, subTaskCount: 5 },
    { parent: null, subTaskCount: 0 },
  ]);
  const fields = callsTo(calls, "/api/v4/acme/stories/search")[0]?.url.searchParams.get("fields");
  expect(fields?.split(",")).toContain("parent_story");
  expect(fields?.split(",")).toContain("sub_task_stories");
  expect(callsTo(calls, "/api/v4/acme/stories/search")).toHaveLength(1);
  expect(calls.filter((call) => call.url.pathname.endsWith("/sub-task-stories"))).toHaveLength(0);
});

test("getStory asks for no sub-tasks when the story has none", async () => {
  const { client, calls } = stub(whoamiRoute, story42(), noComments);
  const story = await client.getStory(storyId.parse(42));
  expect(story.subTasks).toEqual([]);
  expect(callsTo(calls, CHILDREN)).toHaveLength(0);
});

test("getStory reads every page of sub-tasks and places each in its own workflow state", async () => {
  const { client, calls } = stub(
    whoamiRoute,
    story42({ sub_task_stories: subTaskList(3, 2) }),
    noComments,
    at(
      CHILDREN,
      json(
        page(
          [
            storyJson(50, { name: "First", workflow_state: done, parent_story: parentRef }),
            storyJson(51, { name: "Second", workflow_state: inProgress, parent_story: parentRef }),
          ],
          `${API}${CHILDREN}?cursor=c2`,
          3,
        ),
      ),
    ),
    at(CHILDREN, json(page([storyJson(52, { name: "Third" })], null, 3)), "c2"),
  );

  const { subTasks } = await client.getStory(storyId.parse(42));

  expect(subTasks.map(({ id, name, state }) => ({ id, name, progress: state.progress }))).toEqual([
    { id: storyId.parse(50), name: "First", progress: "done" },
    { id: storyId.parse(51), name: "Second", progress: "started" },
    { id: storyId.parse(52), name: "Third", progress: "unstarted" },
  ]);
  const [first, second] = callsTo(calls, CHILDREN);
  expect(first?.url.searchParams.get("limit")).toBe("100");
  expect(first?.url.searchParams.get("fields")?.split(",")).toContain("workflow_state");
  expect(second?.url.searchParams.get("cursor")).toBe("c2");
  expect(callsTo(calls, CHILDREN)).toHaveLength(2);
});

const statesGrowing = (): Route => {
  let answered = 0;
  return (url, method) => {
    if (method !== "GET" || url.pathname !== "/api/v4/acme/workflow-states") return undefined;
    answered += 1;
    const states =
      answered === 1 ? workflowStates.filter((state) => state.id !== 500000005) : workflowStates;
    return Response.json(page(states, null, states.length));
  };
};

test("a sub-task in a state the cached list lacks reloads the states instead of failing", async () => {
  const { client } = stub(
    whoamiRoute,
    statesGrowing(),
    story42({ sub_task_stories: subTaskList(1, 1) }),
    noComments,
    at(CHILDREN, json(page([storyJson(50, { workflow_state: done })], null, 1))),
  );
  const { subTasks } = await client.getStory(storyId.parse(42));
  expect(subTasks[0]?.state.name).toBe("Done");
});

test("a failed sub-task list fails the detail load, naming the call", async () => {
  const { client } = stub(
    whoamiRoute,
    story42({ sub_task_stories: subTaskList(1, 1) }),
    noComments,
  );
  const { message } = await rejection(client.getStory(storyId.parse(42)));
  expect(message).toContain("Shortcut API 404");
  expect(message).toContain("/sub-task-stories");
});

test("a moved story keeps its parent and sub-task count", async () => {
  const { client } = stub(
    at("/api/v4/whoami", json(whoamiReadWrite)),
    patching(
      STORY,
      json({
        $schema: `${API}/api/v4/schemas/StoryEntityWrapper`,
        entity: storyJson(42, {
          workflow_state: inProgress,
          parent_story: parentRef,
          sub_task_stories: subTaskList(3, 3),
        }),
      }),
    ),
  );
  const moved = await client.moveStory(storyId.parse(42), workflowStateId.parse(500000003));
  expect(moved.parent?.id).toBe(storyId.parse(7));
  expect(moved.subTaskCount).toBe(3);
});
