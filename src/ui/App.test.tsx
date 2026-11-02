import { afterEach, expect, test } from "bun:test";
import { z } from "zod";
import { testRender } from "@opentui/react/test-utils";
import type { Model, Msg, RequestId, Remote, SearchResults } from "../app/model.ts";
import type {
  EpicId,
  MemberId,
  MemberRef,
  StoryDetail,
  StoryId,
  StorySummary,
  Workspace,
  WorkflowStateId,
} from "../shortcut/types.ts";
import { App } from "./App.tsx";

const memberId = (id: string) => z.custom<MemberId>().parse(id);
const stateId = (id: number) => z.custom<WorkflowStateId>().parse(id);
const storyId = (id: number) => z.custom<StoryId>().parse(id);
const requestId = (id: number) => z.custom<RequestId>().parse(id);
const epicId = (id: number) => z.custom<EpicId>().parse(id);

const ada: MemberRef = { id: memberId("ada"), name: "Ada Lovelace" };
const grace: MemberRef = { id: memberId("grace"), name: "Grace Hopper" };

const workspace: Workspace = { me: { ...ada, mentionName: "ada" }, slug: "acme" };

const ready: StorySummary["state"] = {
  id: stateId(1),
  name: "Ready",
  workflowName: "Engineering",
  progress: "unstarted",
  position: 1,
};
const inProgress: StorySummary["state"] = {
  id: stateId(2),
  name: "In Progress",
  workflowName: "Engineering",
  progress: "started",
  position: 2,
};

const summary = (id: number, overrides: Partial<StorySummary> = {}): StorySummary => ({
  id: storyId(id),
  name: `Story number ${id}`,
  storyType: "feature",
  state: ready,
  estimate: 3,
  owners: [ada],
  epic: null,
  appUrl: `https://app.shortcut.com/acme/story/${id}`,
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  pullRequestCount: 0,
  ...overrides,
});

const loaded = <T,>(value: T): Remote<T> => ({ status: "loaded", value });

const modelWith = (overrides: Partial<Model>): Model => ({
  workspace: loaded(workspace),
  query: "owner:me",
  results: loaded<SearchResults>({ query: "owner:me", stories: [] }),
  selectedStoryId: null,
  details: new Map(),
  pullRequests: loaded(new Map()),
  focus: { mode: "browsing" },
  nextRequestId: requestId(10),
  ...overrides,
});

const stories = [
  summary(101, { name: "Fix login redirect", storyType: "bug", state: inProgress }),
  summary(102, {
    name: "Add dark mode",
    owners: [ada, grace],
    epic: { id: epicId(7), name: "Theming" },
  }),
  summary(103, { name: "Rotate API keys", storyType: "chore", estimate: null }),
];

const detail: StoryDetail = {
  ...stories[1],
  description: "Users want a dark theme.",
  labels: ["design", "frontend"],
  comments: [
    {
      id: 1,
      author: grace,
      text: "Let us ship it behind a flag.",
      createdAt: new Date("2026-10-05T12:00:00Z"),
    },
    {
      id: 2,
      author: null,
      text: "Linked a pull request.",
      createdAt: new Date("2026-10-06T12:00:00Z"),
    },
  ],
};

const browsing = (overrides: Partial<Model> = {}) =>
  modelWith({
    results: loaded({ query: "owner:me", stories }),
    selectedStoryId: stories[1].id,
    details: new Map([[detail.id, loaded(detail)]]),
    ...overrides,
  });

type Rendered = Awaited<ReturnType<typeof testRender>>;
let current: Rendered | null = null;

afterEach(async () => {
  current?.renderer.destroy();
  current = null;
});

const show = async (model: Model, options: { height?: number; width?: number } = {}) => {
  const dispatched: Msg[] = [];
  const calls = { quit: 0, opened: [] as string[] };
  const screen = await testRender(
    <App
      model={model}
      dispatch={(msg) => dispatched.push(msg)}
      quit={() => {
        calls.quit += 1;
      }}
      openUrl={(url) => calls.opened.push(url)}
    />,
    { width: options.width ?? 120, height: options.height ?? 30 },
  );
  current = screen;
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  await screen.renderOnce();
  return { screen, dispatched, calls, frame: () => screen.captureCharFrame() };
};

test("lists stories with id, name, state and estimate", async () => {
  const { frame } = await show(browsing());
  const text = frame();
  expect(text).toContain("101");
  expect(text).toContain("Fix login redirect");
  expect(text).toContain("In Progress");
  expect(text).toContain("Rotate API keys");
  expect(text).toContain("3 stories");
  expect(text).toContain("owner:me");
});

test("a divider names each workflow state group above its stories", async () => {
  const { frame } = await show(browsing());
  const lines = frame().split("\n");
  const rowOf = (needle: string) => lines.findIndex((line) => line.includes(needle));
  const dividers = lines.filter((line) => line.includes("──"));
  expect(dividers.length).toBe(2);
  expect(dividers[0]).toMatch(/In Progress\s+1\s+· Engineering/);
  expect(dividers[1]).toMatch(/Ready\s+2\s+· Engineering/);
  expect(rowOf("In Progress  1")).toBeLessThan(rowOf(" 101 "));
  expect(rowOf(" 101 ")).toBeLessThan(rowOf("Ready  2"));
  expect(rowOf("Ready  2")).toBeLessThan(rowOf(" 102 "));
  expect(rowOf(" 103 ") - rowOf(" 102 ")).toBe(1);
});

test("marks the selected row and shows its detail", async () => {
  const { frame } = await show(browsing());
  const text = frame();
  const selectedRow = text.split("\n").find((line) => line.includes(" 102 "));
  expect(selectedRow).toContain("▌");
  expect(text.split("\n").find((line) => line.includes(" 101 "))).not.toContain("▌");
  expect(text).toContain("Ada Lovelace, Grace Hopper");
  expect(text).toContain("Theming");
  expect(text).toContain("design, frontend");
  expect(text).toContain("https://app.shortcut.com/acme/story/102");
  expect(text).toContain("Users want a dark theme.");
  expect(text).toContain("Comments (2)");
  expect(text).toContain("Grace Hopper  2026-10-05");
  expect(text).toContain("Let us ship it behind a flag.");
  expect(text).toContain("Unknown  2026-10-06");
});

test("shows a loading note while the selected story detail is loading", async () => {
  const { frame } = await show(
    browsing({ details: new Map([[detail.id, { status: "loading", requestId: requestId(5) }]]) }),
  );
  expect(frame()).toContain("Loading details…");
  expect(frame()).toContain("Add dark mode");
});

test("shows the failure when the detail cannot load", async () => {
  const { frame } = await show(
    browsing({ details: new Map([[detail.id, { status: "failed", message: "boom" }]]) }),
  );
  expect(frame()).toContain("Could not load details: boom");
});

test("shows a loading screen while searching", async () => {
  const { frame } = await show(
    modelWith({ results: { status: "loading", requestId: requestId(2) } }),
  );
  expect(frame()).toContain("Loading stories…");
});

test("shows an empty state when nothing matches", async () => {
  const { frame } = await show(modelWith({}));
  expect(frame()).toContain("No stories match");
  expect(frame()).toContain("0 stories");
});

test("shows a search failure with a retry hint", async () => {
  const { frame } = await show(modelWith({ results: { status: "failed", message: "HTTP 503" } }));
  expect(frame()).toContain("Search failed");
  expect(frame()).toContain("HTTP 503");
  expect(frame()).toContain("press r to retry");
});

test("shows a workspace failure", async () => {
  const { frame } = await show(modelWith({ workspace: { status: "failed", message: "HTTP 401" } }));
  expect(frame()).toContain("Could not load your workspace");
  expect(frame()).toContain("HTTP 401");
});

test("keeps the selected row visible in a short window", async () => {
  const many = Array.from({ length: 60 }, (_, i) => summary(200 + i, { name: `Row ${200 + i}` }));
  const last = many[59];
  const { screen, frame } = await show(
    modelWith({ results: loaded({ query: "", stories: many }), selectedStoryId: last.id }),
    { height: 12 },
  );
  await screen.renderOnce();
  await screen.renderOnce();
  expect(frame()).toContain("Row 259");
  expect(frame()).not.toContain("Row 200");
});

test("navigation, query, refresh, open and quit keys", async () => {
  const { screen, dispatched, calls } = await show(browsing());
  const { mockInput } = screen;
  mockInput.pressKey("j");
  mockInput.pressKey("k");
  mockInput.pressArrow("down");
  mockInput.pressArrow("up");
  mockInput.pressKey("/");
  mockInput.pressKey("r");
  mockInput.pressKey("o");
  mockInput.pressKey("q");
  mockInput.pressCtrlC();
  expect(dispatched).toEqual([
    { type: "selectionMoved", delta: 1 },
    { type: "selectionMoved", delta: -1 },
    { type: "selectionMoved", delta: 1 },
    { type: "selectionMoved", delta: -1 },
    { type: "queryEditStarted" },
    { type: "refreshRequested" },
  ]);
  expect(calls.opened).toEqual(["https://app.shortcut.com/acme/story/102"]);
  expect(calls.quit).toBe(2);
});

test("while editing the query, typing edits the draft and does not trigger shortcuts", async () => {
  const { screen, dispatched, calls, frame } = await show(
    browsing({ focus: { mode: "editingQuery", draft: "owner:me" } }),
  );
  expect(frame()).toContain("enter search");
  await screen.mockInput.typeText("q");
  screen.mockInput.pressEnter();
  screen.mockInput.pressEscape();
  await Bun.sleep(100);
  expect(calls.quit).toBe(0);
  expect(dispatched).toContainEqual({ type: "querySubmitted" });
  expect(dispatched).toContainEqual({ type: "queryEditCancelled" });
  expect(dispatched.some((msg) => msg.type === "queryDraftChanged")).toBe(true);
  expect(dispatched.some((msg) => msg.type === "selectionMoved")).toBe(false);
});

test("an 80-column terminal shows enough of each story name to read it", async () => {
  const longName = "Add option to limit GitHub PR auto-linking to the first story mention";
  const { frame } = await show(
    browsing({
      results: loaded({ query: "owner:me", stories: [summary(316665, { name: longName })] }),
      selectedStoryId: storyId(316665),
      details: new Map(),
    }),
    { width: 80 },
  );
  expect(frame()).toContain("Add option to limit GitHub PR auto-");
});
