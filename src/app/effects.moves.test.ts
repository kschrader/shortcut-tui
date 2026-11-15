import { expect, test } from "bun:test";
import { z } from "zod";
import type { GitHubClient } from "../github/types.ts";
import {
  at,
  done,
  inProgress,
  patching,
  storyEntity,
  storyJson,
  stub,
  whoamiRoute,
  type Route,
} from "../shortcut/api-stub.ts";
import { createFakeShortcutClient } from "../shortcut/fake.ts";
import { storyId, workflowStateId } from "../shortcut/schemas.ts";
import type { ShortcutClient } from "../shortcut/types.ts";
import { runEffect } from "./effects.ts";
import type { Effect, Msg, RequestId } from "./model.ts";

const STORY = "/api/v4/acme/stories/42";
const READY = 500000002;
const DONE = 500000005;

const github: GitHubClient = {
  pullRequests: () => Promise.reject(new Error("GitHub was not expected to be called")),
};

const moveToDone: Effect = {
  type: "moveStory",
  requestId: z.custom<RequestId>().parse(7),
  storyId: storyId.parse(42),
  stateId: workflowStateId.parse(DONE),
  knownStateId: workflowStateId.parse(READY),
};

const holding = (state?: unknown): Route =>
  at(STORY, storyEntity(storyJson(42, state === undefined ? {} : { workflow_state: state })));

const writingDone = patching(STORY, storyEntity(storyJson(42, { workflow_state: done })));

const move = async (...routes: Route[]) => {
  const { client, calls } = stub(whoamiRoute, ...routes);
  const msg = await runEffect({ shortcut: client, github }, moveToDone, () => new Date(0));
  const requests = calls
    .filter((call) => call.url.pathname === STORY)
    .map((call) => (call.body === null ? call.method : [call.method, call.body]));
  return { msg, requests };
};

const stateIn = (msg: Msg): string | null =>
  msg.type === "moveSucceeded" || msg.type === "moveConflicted" ? msg.story.state.name : null;

test("a move reads the story, then writes it when Shortcut holds the state the app believes", async () => {
  const { msg, requests } = await move(holding(), writingDone);
  expect(requests).toEqual(["GET", ["PATCH", { workflow_state_id: DONE }]]);
  expect(msg).toMatchObject({ type: "moveSucceeded", requestId: 7, storyId: 42 });
  expect(stateIn(msg)).toBe("Done");
});

test("a move writes nothing when Shortcut holds another state, and reports the story it read", async () => {
  const { msg, requests } = await move(holding(inProgress), writingDone);
  expect(requests).toEqual(["GET"]);
  expect(msg).toMatchObject({ type: "moveConflicted", requestId: 7, storyId: 42 });
  expect(stateIn(msg)).toBe("In Progress");
});

test("a move writes nothing and succeeds when the story is already in the picked state", async () => {
  const { msg, requests } = await move(holding(done), writingDone);
  expect(requests).toEqual(["GET"]);
  expect(msg).toMatchObject({ type: "moveSucceeded", requestId: 7, storyId: 42 });
  expect(stateIn(msg)).toBe("Done");
});

test("a read that fails becomes a moveFailed message for the story, and nothing is written", async () => {
  const { msg, requests } = await move(writingDone);
  expect(requests).toEqual(["GET"]);
  expect(msg).toEqual({
    type: "moveFailed",
    requestId: moveToDone.requestId,
    storyId: storyId.parse(42),
    message: "Shortcut API 404 for GET /api/v4/acme/stories/42 (not_found)",
  });
});

test("a write that Shortcut refuses becomes a moveFailed message for the story", async () => {
  const refusing = patching(STORY, () =>
    Response.json({ message: "Unprocessable", tag: "invalid_workflow_state" }, { status: 422 }),
  );
  const { msg, requests } = await move(holding(), refusing);
  expect(requests).toEqual(["GET", ["PATCH", { workflow_state_id: DONE }]]);
  expect(msg).toEqual({
    type: "moveFailed",
    requestId: moveToDone.requestId,
    storyId: storyId.parse(42),
    message: "Shortcut API 422 for PATCH /api/v4/acme/stories/42 (invalid_workflow_state)",
  });
});

test("a teammate's move between the read and the write is overwritten, because Shortcut has no conditional update", async () => {
  const shortcut = createFakeShortcutClient();
  const { workflowStates } = await shortcut.loadWorkspace();
  const [story] = await shortcut.searchStories("owner:me is:started");
  const teammatesPick = workflowStates.find((state) => state.name === "In Review");
  const yourPick = workflowStates.find((state) => state.name === "Done");
  if (story === undefined || teammatesPick === undefined || yourPick === undefined) {
    throw new Error("the demo workspace changed");
  }
  expect(story.state.name).toBe("In Progress");
  const teammateMovesAfterTheRead: ShortcutClient = {
    ...shortcut,
    getStorySummary: async (id) => {
      const held = await shortcut.getStorySummary(id);
      await shortcut.moveStory(id, teammatesPick.id);
      return held;
    },
  };

  const msg = await runEffect(
    { shortcut: teammateMovesAfterTheRead, github },
    { ...moveToDone, storyId: story.id, stateId: yourPick.id, knownStateId: story.state.id },
    () => new Date(0),
  );

  expect(msg.type).toBe("moveSucceeded");
  expect((await shortcut.getStorySummary(story.id)).state.name).toBe("Done");
});
