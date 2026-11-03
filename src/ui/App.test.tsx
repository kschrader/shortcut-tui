import { afterEach, expect, test } from "bun:test";
import { init } from "../app/update.ts";
import {
  storyId,
  requestId,
  summary,
  loaded,
  reloading,
  modelWith,
  detail,
  browsing,
  show,
  stories,
  cleanup,
} from "./frame.tsx";

afterEach(cleanup);

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

test("the detail pane URL is a terminal hyperlink to the story", async () => {
  const { screen, frame } = await show(browsing());
  const url = "https://app.shortcut.com/acme/story/102";
  const lines = frame().split("\n");
  const row = lines.findIndex((line) => line.includes(url));
  const column = lines[row].indexOf(url);
  expect(screen.renderer.getLinkAt(column, row)).toBe(url);
  expect(screen.renderer.getLinkAt(column + url.length - 1, row)).toBe(url);
  expect(screen.renderer.getLinkAt(column - 2, row)).toBeNull();
});

test("shows a loading note while the selected story detail is loading", async () => {
  const { frame } = await show(
    browsing({ details: new Map([[detail.id, { status: "firstLoad", requestId: requestId(5) }]]) }),
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
    modelWith({ results: { status: "firstLoad", requestId: requestId(2) } }),
  );
  expect(frame()).toContain("Loading stories…");
});

test("shows a loading screen, not an empty result, until the workspace loads", async () => {
  const [starting] = init();
  const { frame } = await show(starting);
  const text = frame();
  expect(text).not.toContain("No stories match");
  expect(text).not.toContain("0 stories");
  expect(text).not.toContain("all stories");
  expect(text).toContain("Connecting to Shortcut");
  expect(text).toContain("loading…");
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
  expect(frame()).not.toContain("0 stories");
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

test("an 80-column terminal shows every browsing key hint", async () => {
  const { frame } = await show(browsing(), { width: 80 });
  const bar = frame().trimEnd().split("\n").at(-1) ?? "";
  const hints = [
    "j/k move",
    "/ query",
    "r refresh",
    "o open",
    "p PR",
    "m move",
    "? help",
    "q quit",
  ];
  for (const hint of hints) expect(bar).toContain(hint);
});

const statusBar = (frame: string) => frame.trimEnd().split("\n").at(-1) ?? "";
const loadedAt = new Date("2026-11-02T09:00:00Z");

test("an 80-column status bar shows how long ago the results loaded beside every key hint", async () => {
  const { frame } = await show(browsing({ loadedAt }), {
    width: 80,
    now: new Date("2026-11-02T09:02:59Z"),
  });
  const bar = statusBar(frame());
  expect(bar).toMatch(/q quit\s+↻ 2m ago\s*$/);
  expect(bar).toContain("j/k move");
});

test("results that just loaded say so", async () => {
  const { frame } = await show(browsing({ loadedAt }), {
    width: 80,
    now: new Date("2026-11-02T09:00:40Z"),
  });
  expect(statusBar(frame())).toMatch(/q quit\s+↻ just now\s*$/);
});

test("a narrow terminal drops the load time before any key hint", async () => {
  const { frame } = await show(browsing({ loadedAt }), {
    width: 72,
    now: new Date("2026-11-02T09:02:00Z"),
  });
  const bar = statusBar(frame());
  expect(bar).not.toContain("↻");
  expect(bar).toContain("q quit");
});

test("no load time shows while the first results load", async () => {
  const { frame } = await show(
    modelWith({ loadedAt, results: { status: "firstLoad", requestId: requestId(2) } }),
    { width: 120, now: new Date("2026-11-02T09:02:00Z") },
  );
  expect(statusBar(frame())).not.toContain("↻");
});

test("the load time of the shown results stays while they reload", async () => {
  const { frame } = await show(
    browsing({
      loadedAt,
      results: loaded({ query: "owner:me", stories }, reloading(requestId(2))),
    }),
    { width: 120, now: new Date("2026-11-02T09:02:00Z") },
  );
  expect(statusBar(frame())).toContain("↻ 2m ago");
  expect(frame().split("\n")[0]).toContain("loading…");
});
