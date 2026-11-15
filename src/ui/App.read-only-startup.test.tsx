import { afterEach, expect, test } from "bun:test";
import { browsing, cleanup, loaded, show, workspace } from "./frame.tsx";
import { hintFor } from "./keys.ts";
import { firstLoad, firstRequestId } from "../app/remote.ts";

afterEach(cleanup);

const statusBar = (frame: string) => frame.trimEnd().split("\n").at(-1) ?? "";
const notice = "! Read-only token: you can browse, but moving stories needs a read-write token";
const readOnly = () => browsing({ workspace: loaded({ ...workspace, canWrite: false }) });

test("a read-only token says so in the bottom bar at startup, in 80 columns", async () => {
  const { frame } = await show(readOnly(), { width: 80 });
  expect(statusBar(frame())).toContain(notice);
});

test("the next key press clears the read-only notice and the key still works", async () => {
  const { screen, dispatched, frame } = await show(readOnly(), { width: 80 });
  screen.mockInput.pressKey("j");
  await screen.renderOnce();
  expect(dispatched).toEqual([{ type: "selectionMoved", delta: 1 }]);
  expect(statusBar(frame())).toContain(hintFor("browsing"));
  expect(statusBar(frame())).not.toContain(notice);
});

test("a read-write token shows no read-only notice", async () => {
  const { frame } = await show(browsing(), { width: 80 });
  expect(statusBar(frame())).not.toContain("Read-only token");
});

test("the read-only notice waits for the workspace to load", async () => {
  const { frame, rerender } = await show(browsing({ workspace: firstLoad(firstRequestId) }), {
    width: 80,
  });
  expect(statusBar(frame())).not.toContain("Read-only token");
  await rerender(readOnly());
  expect(statusBar(frame())).toContain(notice);
});
