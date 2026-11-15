import { expect, test } from "bun:test";
import {
  at,
  inProgress,
  rejection,
  storyEntity,
  storyJson,
  stub,
  whoamiRoute,
} from "./api-stub.ts";
import { storyId, workflowStateId } from "./schemas.ts";

const storyCalls = (calls: { method: string; url: URL }[]) =>
  calls.filter((call) => call.url.pathname.startsWith("/api/v4/acme/stories/"));

test("getStorySummary reads the story once, asks for the summary fields only, and places it in its workflow state", async () => {
  const { client, calls } = stub(
    whoamiRoute,
    at(
      "/api/v4/acme/stories/42",
      storyEntity(
        storyJson(42, { workflow_state: inProgress, updated_at: "2026-11-02T10:00:00Z" }),
      ),
    ),
  );

  const story = await client.getStorySummary(storyId.parse(42));

  expect(story.id).toBe(storyId.parse(42));
  expect(story.state).toMatchObject({
    id: workflowStateId.parse(500000003),
    name: "In Progress",
    progress: "started",
  });
  expect(story.updatedAt).toEqual(new Date("2026-11-02T10:00:00Z"));
  const reads = storyCalls(calls);
  expect(reads.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
    "GET /api/v4/acme/stories/42",
  ]);
  const fields = reads[0]?.url.searchParams.get("fields")?.split(",") ?? [];
  expect(fields).toContain("workflow_state");
  expect(fields).not.toContain("description");
  expect(fields).not.toContain("labels");
});

test("getStorySummary rejects with a 404 naming the story path when the story is gone", async () => {
  const { client } = stub(whoamiRoute);
  const { message } = await rejection(client.getStorySummary(storyId.parse(7)));
  expect(message).toBe("Shortcut API 404 for GET /api/v4/acme/stories/7 (not_found)");
});
