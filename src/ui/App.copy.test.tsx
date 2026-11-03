import { afterEach, expect, test } from "bun:test";
import { browsing, cached, cleanup, reloadFailed, show, stories } from "./frame.tsx";
import { hintFor } from "./keys.ts";

afterEach(cleanup);

const statusBar = (frame: string) => frame.trimEnd().split("\n").at(-1) ?? "";
const selectedUrl = "https://app.shortcut.com/acme/story/102";
const copied = `✓ Copied ${selectedUrl}`;
const noClipboard = "✗ Could not copy: this terminal has no clipboard access";

test("y copies the selected story's link and says so in the bottom bar at 80 columns", async () => {
  const { screen, calls, frame } = await show(browsing(), { width: 80 });
  screen.mockInput.pressKey("y");
  await screen.renderOnce();
  expect(calls.copied).toEqual([selectedUrl]);
  expect(statusBar(frame())).toContain(copied);
});

test("y in a terminal without clipboard access says it could not copy", async () => {
  const { screen, calls, frame } = await show(browsing(), { width: 80, clipboard: "missing" });
  screen.mockInput.pressKey("y");
  await screen.renderOnce();
  expect(calls.copied).toEqual([]);
  expect(statusBar(frame())).toContain(noClipboard);
});

test("the next key press clears the copy notice, whether or not the key is bound", async () => {
  const { screen, dispatched, frame } = await show(browsing(), { width: 80 });
  screen.mockInput.pressKey("y");
  await screen.renderOnce();
  screen.mockInput.pressKey("x");
  await screen.renderOnce();
  expect(statusBar(frame())).toContain(hintFor("browsing"));
  screen.mockInput.pressKey("y");
  await screen.renderOnce();
  screen.mockInput.pressKey("j");
  await screen.renderOnce();
  expect(dispatched).toEqual([{ type: "selectionMoved", delta: 1 }]);
  expect(statusBar(frame())).not.toContain(copied);
});

test("the copy notice goes away when the selected story changes without a key press", async () => {
  const { screen, rerender, frame } = await show(browsing(), { width: 80 });
  screen.mockInput.pressKey("y");
  await screen.renderOnce();
  expect(statusBar(frame())).toContain(copied);
  await rerender(browsing({ selectedStoryId: stories[0].id }));
  expect(statusBar(frame())).toContain(hintFor("browsing"));
});

test("y with no story selected copies nothing and shows no notice", async () => {
  const { screen, calls, frame } = await show(browsing({ selectedStoryId: null }), { width: 80 });
  screen.mockInput.pressKey("y");
  await screen.renderOnce();
  expect(calls.copied).toEqual([]);
  expect(statusBar(frame())).toContain(hintFor("browsing"));
});

test("the copy notice shows over pull request trouble until the next key", async () => {
  const { screen, frame } = await show(
    browsing({ pullRequests: cached(new Map(), reloadFailed("gh is not logged in")) }),
    { width: 80 },
  );
  const trouble = "PR status: gh is not logged in";
  expect(statusBar(frame())).toContain(trouble);
  screen.mockInput.pressKey("y");
  await screen.renderOnce();
  expect(statusBar(frame())).toContain(copied);
  expect(statusBar(frame())).not.toContain(trouble);
  screen.mockInput.pressKey("x");
  await screen.renderOnce();
  expect(statusBar(frame())).toContain(trouble);
});

test("help lists y at 80x24", async () => {
  const { frame } = await show(browsing({ focus: { mode: "help" } }), { width: 80, height: 24 });
  expect(frame().replace(/ +/g, " ")).toContain("y Copy story link");
});
