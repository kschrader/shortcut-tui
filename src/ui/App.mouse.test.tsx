import { RGBA } from "@opentui/core";
import { afterEach, expect, test } from "bun:test";
import { browsing, cleanup, show, stories, type Rendered } from "./frame.tsx";
import { colors } from "./theme.ts";

afterEach(cleanup);

const find = (frame: string, text: string): { x: number; y: number } => {
  const lines = frame.split("\n");
  const y = lines.findIndex((line) => line.includes(text));
  if (y === -1) throw new Error(`"${text}" is not on screen`);
  return { x: lines[y]?.indexOf(text) ?? 0, y };
};

test("clicking a story's title selects that story", async () => {
  const { screen, dispatched, frame } = await show(browsing());
  const title = find(frame(), "Rotate API keys");
  await screen.mockMouse.click(title.x + 2, title.y);
  expect(dispatched).toEqual([{ type: "storyClicked", storyId: stories[2].id }]);
});

test("clicking a story's id selects that story", async () => {
  const { screen, dispatched, frame } = await show(browsing());
  const id = find(frame(), "101");
  await screen.mockMouse.click(id.x, id.y);
  expect(dispatched).toEqual([{ type: "storyClicked", storyId: stories[0].id }]);
});

test("clicking a group divider or right-clicking a story selects nothing", async () => {
  const { screen, dispatched, frame } = await show(browsing());
  const divider = find(frame(), "── Ready");
  await screen.mockMouse.click(divider.x + 4, divider.y);
  const title = find(frame(), "Rotate API keys");
  await screen.mockMouse.click(title.x, title.y, 2);
  expect(dispatched).toEqual([]);
});

const lineColumn = (frame: string): number => frame.split("\n")[3]?.indexOf("│") ?? -1;

test("dragging the line between the panes moves it to where it is dropped", async () => {
  const { screen, frame } = await show(browsing(), { width: 120 });
  const start = lineColumn(frame());
  expect(start).toBe(66);
  await screen.mockMouse.drag(start, 3, 50, 3);
  await screen.renderOnce();
  expect(lineColumn(frame())).toBe(50);
  await screen.mockMouse.drag(50, 3, 80, 8);
  await screen.renderOnce();
  expect(lineColumn(frame())).toBe(80);
});

test("dragging the line past either end stops where both panes stay readable", async () => {
  const { screen, frame } = await show(browsing(), { width: 120 });
  await screen.mockMouse.drag(lineColumn(frame()), 3, 2, 3);
  await screen.renderOnce();
  expect(lineColumn(frame())).toBe(30);
  await screen.mockMouse.drag(30, 3, 118, 3);
  await screen.renderOnce();
  expect(lineColumn(frame())).toBe(89);
});

test("a dragged line stays put when the model changes", async () => {
  const { screen, frame, rerender } = await show(browsing(), { width: 120 });
  await screen.mockMouse.drag(lineColumn(frame()), 3, 45, 3);
  await screen.renderOnce();
  await rerender(browsing({ selectedStoryId: stories[2].id }));
  expect(frame()).toContain("https://app.shortcut.com/acme/story/103");
  expect(lineColumn(frame())).toBe(45);
});

test("a terminal narrowed after a drag keeps the detail pane on screen", async () => {
  const { screen, frame } = await show(browsing(), { width: 120 });
  await screen.mockMouse.drag(lineColumn(frame()), 3, 89, 3);
  await screen.renderOnce();
  screen.resize(80, 30);
  await screen.renderOnce();
  expect(lineColumn(frame())).toBe(49);
});

const lineColor = (screen: Rendered): RGBA | undefined => {
  const spans = screen.captureSpans().lines[3]?.spans ?? [];
  return spans.find((span) => span.text.includes("│"))?.fg;
};

test("the line lights up while the pointer is over it", async () => {
  const { screen, frame } = await show(browsing(), { width: 120 });
  const column = lineColumn(frame());
  expect(lineColor(screen)).toEqual(RGBA.fromHex(colors.dim));
  await screen.mockMouse.moveTo(column, 5);
  await screen.renderOnce();
  expect(lineColor(screen)).toEqual(RGBA.fromHex(colors.accent));
  await screen.mockMouse.moveTo(column - 10, 5);
  await screen.renderOnce();
  expect(lineColor(screen)).toEqual(RGBA.fromHex(colors.dim));
});
