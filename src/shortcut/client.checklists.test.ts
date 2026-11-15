import { expect, test } from "bun:test";
import {
  API,
  at,
  json,
  nested,
  page,
  rejection,
  storyJson,
  stub,
  whoamiRoute,
} from "./api-stub.ts";
import { storyId } from "./schemas.ts";

const STORY = "/api/v4/acme/stories/42";
const CHECKLIST = `${STORY}/checklist-items`;

const slimItems = (total: number) => ({
  ...nested(
    Array.from({ length: Math.min(total, 3) }, (_, index) => ({
      description: `Slim ${String(index)}`,
      entity_type: "checklist-item:slim",
      id: 320000 + index,
      uri: `${API}/api/v4/acme/stories/42/checklist-items/${String(320000 + index)}`,
    })),
    "stories/42/checklist-items",
  ),
  total_items: total,
});

const story42 = (checklistTotal: number) =>
  at(
    STORY,
    json({
      $schema: `${API}/api/v4/schemas/StoryEntityWrapper`,
      entity: storyJson(42, {
        description: "",
        labels: nested([], "stories/42/labels"),
        checklist_items: slimItems(checklistTotal),
      }),
    }),
  );

const noComments = at(`${STORY}/comments`, json(page([], null, 0)));

const item = (id: number, position: number, completed: boolean) => ({
  description: `Item at ${String(position)}`,
  completed,
  id,
  position,
});

const callsTo = (calls: readonly { url: URL }[], path: string) =>
  calls.filter((call) => call.url.pathname === path);

test("getStory asks for no checklist items when the story has none", async () => {
  const { client, calls } = stub(whoamiRoute, story42(0), noComments);
  const story = await client.getStory(storyId.parse(42));
  expect(story.checklist).toEqual([]);
  expect(callsTo(calls, CHECKLIST)).toHaveLength(0);
});

test("getStory reads every page of checklist items and lists them in position order", async () => {
  const total = 101;
  const positions = Array.from({ length: total }, (_, index) => total - 1 - index);
  const items = positions.map((position) => item(400000 + position, position, position % 2 === 0));
  const { client, calls } = stub(
    whoamiRoute,
    story42(total),
    noComments,
    at(CHECKLIST, json(page(items.slice(0, 100), `${API}${CHECKLIST}?cursor=c2`, total))),
    at(CHECKLIST, json(page(items.slice(100), null, total)), "c2"),
  );

  const { checklist } = await client.getStory(storyId.parse(42));

  expect(checklist).toHaveLength(total);
  expect(checklist.slice(0, 3)).toEqual([
    { id: 400000, description: "Item at 0", completed: true },
    { id: 400001, description: "Item at 1", completed: false },
    { id: 400002, description: "Item at 2", completed: true },
  ]);
  expect(checklist.at(-1)).toEqual({ id: 400100, description: "Item at 100", completed: true });
  const [first, second] = callsTo(calls, CHECKLIST);
  expect(first?.url.searchParams.get("limit")).toBe("100");
  expect(first?.url.searchParams.get("fields")?.split(",").toSorted()).toEqual([
    "completed",
    "description",
    "id",
    "position",
  ]);
  expect(second?.url.searchParams.get("cursor")).toBe("c2");
  expect(callsTo(calls, CHECKLIST)).toHaveLength(2);
});

test("the detail request asks for the story's checklist count", async () => {
  const { client, calls } = stub(whoamiRoute, story42(0), noComments);
  await client.getStory(storyId.parse(42));
  const fields = callsTo(calls, STORY)[0]?.url.searchParams.get("fields")?.split(",");
  expect(fields).toContain("checklist_items");
});

test("a failed checklist list fails the detail load, naming the call", async () => {
  const { client } = stub(whoamiRoute, story42(2), noComments);
  const { message } = await rejection(client.getStory(storyId.parse(42)));
  expect(message).toContain("Shortcut API 404");
  expect(message).toContain("/checklist-items");
});
