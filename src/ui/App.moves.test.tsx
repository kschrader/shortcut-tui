import { afterEach, expect, test } from "bun:test";
import type { StoryMove } from "../app/model.ts";
import { queryQuestion } from "../app/filters.ts";
import type { StoryId } from "../shortcut/types.ts";
import {
  browsing,
  cleanup,
  done,
  inProgress,
  loaded,
  ready,
  requestId,
  show,
  stateId,
  stories,
  summary,
} from "./frame.tsx";
import { hintFor } from "./keys.ts";

afterEach(cleanup);

const picking = (cursor: number) =>
  browsing({ focus: { mode: "picking", storyId: stories[1].id, cursor } });

const rowOf = (text: string, needle: string) =>
  text.split("\n").find((line) => line.includes(needle));

test("the picker lists the story's workflow states in order, marks the current one and highlights the cursor, at 80x24", async () => {
  const { frame } = await show(picking(1), { width: 80, height: 24 });
  const text = frame();
  expect(text).toContain("Move 102");
  expect(text).toContain("Engineering workflow");
  const lines = text.split("\n");
  const readyRow = lines.findIndex((line) => /● Ready\s+current/.test(line));
  const inProgressRow = lines.findIndex((line) => line.includes("▌  In Progress"));
  const doneRow = lines.findIndex((line) => /\sDone\s/.test(line) && line.includes("│"));
  expect(readyRow).toBeGreaterThan(0);
  expect(inProgressRow).toBe(readyRow + 1);
  expect(doneRow).toBe(inProgressRow + 1);
  const top = lines.findIndex((line) => line.includes("╭"));
  const bottom = lines.findIndex((line) => line.includes("╰"));
  expect(top).toBeGreaterThan(0);
  expect(bottom).toBeLessThan(23);
  expect(text).toContain(hintFor("picking"));
});

test("a long workflow scrolls the picker to keep the cursor visible inside 80x24", async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    ...ready,
    id: stateId(500 + i),
    name: `State ${String(500 + i)}`,
    position: i,
  }));
  const workspace = { ...picking(0).workspace };
  if (workspace.status !== "loaded") throw new Error("workspace fixture not loaded");
  const story = summary(7, { state: many[0] });
  const { frame } = await show(
    browsing({
      workspace: loaded({ ...workspace.value, workflowStates: many }),
      results: loaded({ question: queryQuestion("owner:me"), stories: [story] }),
      selectedStoryId: story.id,
      details: new Map(),
      focus: { mode: "picking", storyId: story.id, cursor: 39 },
    }),
    { width: 80, height: 24 },
  );
  const text = frame();
  const lines = text.split("\n");
  expect(text).toContain("▌  State 539");
  expect(lines.filter((line) => line.startsWith("│") && line.includes("State 500"))).toEqual([]);
  expect(text.split("\n").filter((line) => line.includes("╰"))).toHaveLength(1);
});

test("picker keys go through the key table and other keys do nothing", async () => {
  const { screen, dispatched, calls } = await show(picking(0));
  const { mockInput } = screen;
  mockInput.pressKey("j");
  mockInput.pressArrow("down");
  mockInput.pressKey("k");
  mockInput.pressArrow("up");
  mockInput.pressEnter();
  for (const key of ["q", "/", "r", "o", "p", "?", "m"]) mockInput.pressKey(key);
  mockInput.pressEscape();
  await Bun.sleep(100);
  expect(dispatched).toEqual([
    { type: "movePickerMoved", delta: 1 },
    { type: "movePickerMoved", delta: 1 },
    { type: "movePickerMoved", delta: -1 },
    { type: "movePickerMoved", delta: -1 },
    { type: "movePickerConfirmed" },
    { type: "movePickerClosed" },
  ]);
  expect(calls.quit).toBe(0);
  expect(calls.opened).toEqual([]);
  mockInput.pressCtrlC();
  expect(calls.quit).toBe(1);
});

test("m opens the picker while browsing and is ignored while help is open", async () => {
  const { screen, dispatched, frame } = await show(browsing());
  expect(frame()).toContain("m move");
  screen.mockInput.pressKey("m");
  expect(dispatched).toEqual([{ type: "movePickerOpened" }]);
  const { screen: help, dispatched: whileHelping } = await show(
    browsing({ focus: { mode: "help" } }),
  );
  help.mockInput.pressKey("m");
  await Bun.sleep(50);
  expect(whileHelping).toEqual([]);
});

test("a saving story shows a saving marker, a failed one a failed marker, and the bottom bar explains the selected failure", async () => {
  const saving: StoryMove = {
    status: "saving",
    requestId: requestId(11),
    target: inProgress,
    pending: null,
    known: ready,
    trustFrom: requestId(1),
  };
  const failed: StoryMove = {
    status: "failed",
    message: "Shortcut API 422 for PATCH /api/v4/acme/stories/103 (invalid_workflow_state)",
    known: ready,
    trustFrom: requestId(1),
  };
  const { frame } = await show(
    browsing({
      moves: new Map<StoryId, StoryMove>([
        [stories[0].id, saving],
        [stories[2].id, failed],
      ]),
      selectedStoryId: stories[2].id,
    }),
    { width: 80, height: 24 },
  );
  const text = frame();
  expect(rowOf(text, " 101 ")).toContain("⟳ saving");
  expect(rowOf(text, " 103 ")).toContain("✗ failed");
  expect(rowOf(text, " 102 ")).not.toContain("saving");
  expect(text).toContain("✗ Move failed  ·  m to retry  ·  Shortcut API 422");
});

test("a moved story shows no marker and the bottom bar shows the usual hints", async () => {
  const moved: StoryMove = { status: "moved", known: done, trustFrom: requestId(9) };
  const { frame } = await show(browsing({ moves: new Map([[stories[1].id, moved]]) }));
  const text = frame();
  expect(text).not.toContain("saving");
  expect(text).not.toContain("failed");
  expect(text).toContain(hintFor("browsing"));
});

test("the read-only notice says what to do and esc closes it, at 80x24", async () => {
  const { screen, dispatched, frame } = await show(browsing({ focus: { mode: "readOnly" } }), {
    width: 80,
    height: 24,
  });
  const text = frame();
  expect(text).toContain("Read-only token");
  expect(text).toContain("nothing was sent");
  expect(text).toContain("read-write sct_ token");
  expect(text).toContain("https://app.shortcut.com/settings/account/api-tokens");
  expect(text).toContain("esc close");
  const lines = text.split("\n");
  expect(lines.findIndex((line) => line.includes("╭"))).toBeGreaterThan(0);
  expect(lines.findIndex((line) => line.includes("╰"))).toBeLessThan(23);
  screen.mockInput.pressKey("j");
  screen.mockInput.pressEscape();
  await Bun.sleep(100);
  expect(dispatched).toEqual([{ type: "readOnlyNoticeClosed" }]);
});
