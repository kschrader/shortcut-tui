import { afterEach, expect, test } from "bun:test";
import type { Model, Msg, StartupList } from "../app/model.ts";
import { requestsIn } from "../app/remote.ts";
import { init, update } from "../app/update.ts";
import { cleanup, show, stories, workspace } from "./frame.tsx";

afterEach(cleanup);

const savedAt = new Date("2026-11-02T06:00:00Z");
const now = new Date("2026-11-02T09:00:00Z");
const saved: StartupList = { mentionName: "ada", savedAt, stories };
const size = { width: 80, height: 24, now };

const lines = (frame: string) => frame.trimEnd().split("\n");
const header = (frame: string) => lines(frame)[0] ?? "";
const bottom = (frame: string) => lines(frame).at(-1) ?? "";

const run = (model: Model, msg: Msg) => update(model, msg);

const startup = () => {
  const [model, effects] = init(saved);
  const [load] = requestsIn(effects);
  if (load?.type !== "loadWorkspace") throw new Error("init loads the workspace");
  return { model, load };
};

const loggedIn = () => {
  const { model, load } = startup();
  const [loaded, effects] = run(model, {
    type: "workspaceLoaded",
    requestId: load.requestId,
    workspace,
  });
  const [search] = requestsIn(effects);
  if (search?.type !== "searchStories") throw new Error("the workspace starts a search");
  return { model: loaded, search };
};

test("at 80x24 the cached list shows at once, marked cached with its age", async () => {
  const { frame } = await show(startup().model, size);
  expect(header(frame())).toContain("my started stories");
  expect(header(frame())).toContain("cached 3h ago  ·  loading…");
  expect(frame()).toContain("Fix login redirect");
  expect(frame()).toContain("Add dark mode");
  expect(frame()).not.toContain("Connecting to Shortcut");
  expect(lines(frame())).toHaveLength(24);
});

test("a selected cached row shows its cached fields and says details wait for Shortcut", async () => {
  const { frame } = await show(startup().model, size);
  expect(frame()).toContain("In Progress for");
  expect(frame()).toContain("Details load when");
  expect(frame()).not.toContain("Loading details…");
});

test("a cached row that links pull requests shows no badge and no empty pull request list", async () => {
  const linked = { ...stories[0], pullRequestCount: 2 };
  const [model] = init({ ...saved, stories: [linked] });
  const { frame } = await show(model, size);
  expect(frame()).not.toContain("Pull requests");
  expect(frame()).not.toContain("checking");
});

test("the marker stays while the first search is out after the workspace loads", async () => {
  const { frame } = await show(loggedIn().model, size);
  expect(header(frame())).toContain("cached 3h ago  ·  loading…");
});

test("a failed first search keeps the cached list, still marked, and says so", async () => {
  const { model, search } = loggedIn();
  const [failed] = run(model, {
    type: "searchFailed",
    requestId: search.requestId,
    message: "HTTP 503",
  });
  const { frame } = await show(failed, size);
  expect(header(frame())).toContain("cached 3h ago");
  expect(header(frame())).not.toContain("loading…");
  expect(bottom(frame())).toContain("✗ Refresh failed  ·  r to retry  ·  HTTP 503");
  expect(frame()).toContain("Fix login redirect");
});

test("a failed workspace keeps the cached list and says why in the bottom bar", async () => {
  const { model, load } = startup();
  const [failed] = run(model, {
    type: "workspaceFailed",
    requestId: load.requestId,
    message: "offline",
  });
  const { frame } = await show(failed, size);
  expect(header(frame())).toContain("cached 3h ago");
  expect(bottom(frame())).toContain("✗ Could not load your workspace  ·  r to retry  ·  offline");
  expect(frame()).toContain("Fix login redirect");
});

test("once the search answers, nothing says cached", async () => {
  const { model, search } = loggedIn();
  const [answered] = run(model, {
    type: "searchSucceeded",
    requestId: search.requestId,
    stories: [stories[0]],
    loadedAt: now,
  });
  const { frame } = await show(answered, size);
  expect(frame()).not.toContain("cached");
  expect(header(frame())).toContain("1 story");
  expect(frame()).not.toContain("Add dark mode");
});

test("without a saved list, startup still shows the connecting screen", async () => {
  const [model] = init();
  const { frame } = await show(model, size);
  expect(frame()).toContain("Connecting to Shortcut");
  expect(frame()).not.toContain("cached");
});
