import { expect, test } from "bun:test";
import { z } from "zod";
import type { ShortcutClient, StoryId } from "../shortcut/types.ts";
import { runEffect } from "./effects.ts";
import type { RequestId } from "./model.ts";

const requestId = z.custom<RequestId>().parse(7);
const storyId = z.custom<StoryId>().parse(42);

const failingClient: ShortcutClient = {
  loadWorkspace: () => Promise.reject(new Error("offline")),
  searchStories: () => Promise.reject(new Error("HTTP 500")),
  getStory: () => Promise.reject(new Error("not found")),
};

test("a failing workspace load becomes a workspaceFailed message", async () => {
  expect(await runEffect(failingClient, { type: "loadWorkspace", requestId })).toEqual({
    type: "workspaceFailed",
    requestId,
    message: "offline",
  });
});

test("a failing search becomes a searchFailed message", async () => {
  expect(await runEffect(failingClient, { type: "searchStories", requestId, query: "x" })).toEqual({
    type: "searchFailed",
    requestId,
    message: "HTTP 500",
  });
});

test("a failing story fetch carries the story id", async () => {
  expect(await runEffect(failingClient, { type: "getStory", requestId, storyId })).toEqual({
    type: "detailFailed",
    requestId,
    storyId,
    message: "not found",
  });
});

test("a non-Error rejection still produces a failure message", async () => {
  const client: ShortcutClient = {
    ...failingClient,
    searchStories: () => Promise.reject(new Error("x", { cause: "y" }).cause),
  };
  const msg = await runEffect(client, { type: "searchStories", requestId, query: "x" });
  expect(msg).toEqual({ type: "searchFailed", requestId, message: "y" });
});
