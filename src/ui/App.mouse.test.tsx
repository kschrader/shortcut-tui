import { afterEach, expect, test } from "bun:test";
import { browsing, cleanup, show, stories } from "./frame.tsx";

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
