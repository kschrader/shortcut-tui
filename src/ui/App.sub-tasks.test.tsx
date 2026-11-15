import { afterEach, expect, test } from "bun:test";
import { queryQuestion } from "../app/filters.ts";
import type { StorySummary } from "../shortcut/types.ts";
import { nameCell } from "./format.ts";
import {
  ada,
  browsing,
  cleanup,
  detail,
  done,
  grace,
  inProgress,
  launchDemo,
  loaded,
  ready,
  show,
  storyId,
  summary,
} from "./frame.tsx";

afterEach(cleanup);

const LONG_NAME = "Rework the onboarding checklist so every new workspace starts somewhere useful";

const parentRef = {
  id: storyId(7),
  name: "Onboarding redesign",
  appUrl: "https://app.shortcut.com/acme/story/7",
};

const plain = summary(201, { name: "Plain story" });
const child = summary(202, { name: "A sub-task", parent: parentRef });
const parent = summary(203, { name: "A parent", subTaskCount: 5 });
const both = summary(204, { name: "Both at once", parent: parentRef, subTaskCount: 12 });
const longChild = summary(205, { name: LONG_NAME, parent: parentRef });
const longParent = summary(206, { name: LONG_NAME, subTaskCount: 5 });
const rows = [plain, child, parent, both, longChild, longParent];

const showing = (stories: readonly StorySummary[], selected = stories[0]) =>
  browsing({
    results: loaded({ question: queryQuestion("owner:me"), stories }),
    selectedStoryId: selected?.id ?? null,
    details: new Map(),
  });

const listPart = (frame: string, id: number) => {
  const line = frame.split("\n").find((row) => row.includes(` ${String(id)} `)) ?? "";
  return line.slice(0, line.indexOf("│"));
};

test("marks start the name, take their width from the name column, and every row stays the same length", async () => {
  const { frame } = await show(showing(rows), { width: 80, height: 24 });
  const shown = rows.map((row) => listPart(frame(), row.id));
  expect(new Set(shown.map((line) => line.length)).size).toBe(1);
  expect(shown[0]).toContain(" 201 Plain story");
  expect(shown[1]).toContain(" 202 ↳ A sub-task");
  expect(shown[2]).toContain(" 203 ▸5 A parent");
  expect(shown[3]).toContain(" 204 ↳ ▸12 Both at once");
  const waited = shown.map((line) => line.trimEnd().slice(-6));
  expect(new Set(waited).size).toBe(1);
});

test("a long name still ends in an ellipsis behind its mark", async () => {
  const { frame } = await show(showing(rows), { width: 80, height: 24 });
  expect(listPart(frame(), 205)).toMatch(/ 205 ↳ Rework the\S* .*…/);
  expect(listPart(frame(), 206)).toMatch(/ 206 ▸5 Rework the\S* .*…/);
});

test("rows stay the same length at every width", async () => {
  for (const width of [50, 62, 80, 100, 120]) {
    const { frame } = await show(showing(rows), { width, height: 24 });
    const lengths = rows.map((row) => listPart(frame(), row.id).length);
    expect(new Set(lengths).size).toBe(1);
    cleanup();
  }
});

test("a name column too narrow for the mark keeps its width", () => {
  for (const width of [1, 2, 3, 4]) {
    const { marks, name } = nameCell(both, width);
    const cell = `${marks.map((mark) => mark.text).join("")}${name}`;
    expect(cell).toHaveLength(width);
    expect(cell.endsWith("…")).toBe(true);
  }
});

test("a row without a family link shows no mark", async () => {
  const { frame } = await show(showing([plain, summary(207, { name: "Also plain" })]), {
    width: 80,
    height: 24,
  });
  expect(frame()).not.toContain("↳");
  expect(frame()).not.toContain("▸");
});

const withChildren = {
  ...detail,
  id: parent.id,
  subTasks: [
    summary(301, { name: "Not begun", state: ready, owners: [] }),
    summary(302, { name: "Finished work", state: done, owners: [grace] }),
    summary(303, { name: "Underway", state: inProgress, owners: [ada, grace] }),
  ],
};

const parentOpen = (height = 40) =>
  show(
    browsing({
      results: loaded({ question: queryQuestion("owner:me"), stories: [parent] }),
      selectedStoryId: parent.id,
      details: new Map([[parent.id, loaded(withChildren)]]),
    }),
    { width: 80, height },
  );

const detailText = (frame: string) =>
  frame
    .split("\n")
    .map((line) => line.slice(line.indexOf("│") + 1).trim())
    .join(" ")
    .replace(/ +/g, " ");

test("a parent's detail counts its done sub-tasks and lists each with state and owner, furthest along first", async () => {
  const { frame } = await parentOpen();
  const text = detailText(frame());
  expect(text).toContain("Sub-tasks (1/3 done)");
  const finished = text.indexOf("✓ 302 Finished work Done · Grace Hopper");
  const underway = text.indexOf("◐ 303 Underway In Progress · Ada Lovelace, Grace Hopper");
  const notBegun = text.indexOf("○ 301 Not begun Ready · Unassigned");
  expect(finished).toBeGreaterThan(-1);
  expect(underway).toBeGreaterThan(finished);
  expect(notBegun).toBeGreaterThan(underway);
  expect(text.indexOf("Labels")).toBeLessThan(text.indexOf("Sub-tasks"));
  expect(text.indexOf("Sub-tasks")).toBeLessThan(text.indexOf("Description"));
});

test("each sub-task's id links to that story", async () => {
  const { screen, frame } = await parentOpen();
  const lines = frame().split("\n");
  const row = lines.findIndex((line) => line.includes("✓ 302"));
  const column = lines[row].indexOf("302");
  expect(screen.renderer.getLinkAt(column, row)).toBe("https://app.shortcut.com/acme/story/302");
  expect(screen.renderer.getLinkAt(column + 2, row)).toBe(
    "https://app.shortcut.com/acme/story/302",
  );
  expect(screen.renderer.getLinkAt(column + 4, row)).toBeNull();
});

test("a story with no sub-tasks has no section", async () => {
  const { frame } = await show(browsing());
  expect(frame()).toContain("Description");
  expect(frame()).not.toContain("Sub-tasks");
});

test("a sub-task shows its linked parent before its detail has loaded", async () => {
  const { screen, frame } = await show(showing([child]), { width: 80, height: 24 });
  expect(frame()).toContain("Loading details…");
  const lines = frame().split("\n");
  const row = lines.findIndex((line) => line.includes("Parent "));
  const pane = lines[row].slice(lines[row].indexOf("│") + 1).replace(/ +/g, " ");
  expect(pane).toContain("Parent 7 Onboarding");
  const column = lines[row].indexOf(" 7 Onboarding") + 1;
  expect(screen.renderer.getLinkAt(column, row)).toBe(parentRef.appUrl);
});

test("a story without a parent shows no Parent field", async () => {
  const { frame } = await show(showing([plain]), { width: 80, height: 24 });
  expect(frame()).toContain("Epic");
  expect(frame()).not.toContain("Parent");
});

test("the demo shows a parent's sub-tasks, one of which is also a row in the list", async () => {
  const { frame, until, press } = await launchDemo({ height: 50 });
  await until(() => frame().includes(" 1016 ▸4 "));
  expect(frame()).toContain(" 1018 ▲ ↳ ");
  for (let step = 0; step < 20 && !frame().includes("▌●   1016"); step += 1) await press("j");
  await until(() => frame().includes("Sub-tasks (1/4 done)"));
  const text = detailText(frame());
  expect(text).toContain("◐ 1018 Stream audit events to a file In Progress · Demo User");
  expect(text).toContain("○ 1020 Document the audit log columns Backlog · Unassigned");
});
