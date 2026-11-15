import { expect, test } from "bun:test";
import {
  API,
  at,
  inProgress,
  json,
  page,
  patching,
  storyJson,
  stub,
  whoamiReadWrite,
  whoamiRoute,
} from "./api-stub.ts";
import { storyId, workflowStateId } from "./schemas.ts";

const SEARCH = "/api/v4/acme/stories/search";

test("a search reads whether each story is blocked or blocks another, in the same request", async () => {
  const { client, calls } = stub(
    whoamiRoute,
    at(
      SEARCH,
      json(
        page(
          [
            storyJson(1, { blocked: true, blocker: false }),
            storyJson(2, { blocked: false, blocker: true }),
            storyJson(3, { blocked: true, blocker: true }),
            storyJson(4),
          ],
          null,
          4,
        ),
      ),
    ),
  );

  const stories = await client.searchStories("owner:kurt");

  expect(stories.map(({ id, blocked, blocker }) => ({ id, blocked, blocker }))).toEqual([
    { id: storyId.parse(1), blocked: true, blocker: false },
    { id: storyId.parse(2), blocked: false, blocker: true },
    { id: storyId.parse(3), blocked: true, blocker: true },
    { id: storyId.parse(4), blocked: false, blocker: false },
  ]);
  const searches = calls.filter((call) => call.url.pathname === SEARCH);
  expect(searches).toHaveLength(1);
  const fields = searches[0]?.url.searchParams.get("fields")?.split(",");
  expect(fields).toContain("blocked");
  expect(fields).toContain("blocker");
});

test("a moved story keeps whether it is blocked or blocks another", async () => {
  const { client } = stub(
    at("/api/v4/whoami", json(whoamiReadWrite)),
    patching(
      "/api/v4/acme/stories/42",
      json({
        $schema: `${API}/api/v4/schemas/StoryEntityWrapper`,
        entity: storyJson(42, { workflow_state: inProgress, blocked: true, blocker: true }),
      }),
    ),
  );
  const moved = await client.moveStory(storyId.parse(42), workflowStateId.parse(500000003));
  expect({ blocked: moved.blocked, blocker: moved.blocker }).toEqual({
    blocked: true,
    blocker: true,
  });
});
