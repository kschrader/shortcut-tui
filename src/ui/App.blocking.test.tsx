import { RGBA } from "@opentui/core";
import { afterEach, expect, test } from "bun:test";
import { queryQuestion } from "../app/filters.ts";
import type { StorySummary } from "../shortcut/types.ts";
import {
  browsing,
  cleanup,
  launchDemo,
  loaded,
  show,
  storyId,
  summary,
  type Rendered,
} from "./frame.tsx";
import { colors } from "./theme.ts";

afterEach(cleanup);

const LONG_NAME = "Rework the onboarding checklist so every new workspace starts somewhere useful";

const parentRef = {
  id: storyId(7),
  name: "Onboarding redesign",
  appUrl: "https://app.shortcut.com/acme/story/7",
};

const plain = summary(401, { name: "Plain story" });
const blocked = summary(402, { name: "Waits on another", blocked: true });
const blocker = summary(403, { name: "Holds up another", blocker: true });
const both = summary(404, {
  name: "Waits and holds up",
  blocked: true,
  blocker: true,
  parent: parentRef,
  subTaskCount: 3,
});
const longBlocked = summary(405, { name: LONG_NAME, blocked: true, blocker: true });
const rows = [plain, blocked, blocker, both, longBlocked];

const showing = (stories: readonly StorySummary[], selected = stories[0]) =>
  browsing({
    results: loaded({ question: queryQuestion("owner:me"), stories }),
    selectedStoryId: selected?.id ?? null,
    details: new Map(),
  });

const rowIndex = (frame: string, id: number) =>
  frame.split("\n").findIndex((row) => row.includes(` ${String(id)} `));

const listPart = (frame: string, id: number) => {
  const line = frame.split("\n")[rowIndex(frame, id)] ?? "";
  return line.slice(0, line.indexOf("│"));
};

const detailText = (frame: string) =>
  frame
    .split("\n")
    .map((line) => line.slice(line.indexOf("│") + 1).trim())
    .join(" ")
    .replace(/ +/g, " ");

test("a blocked story and a blocker are marked at the start of the name, before family marks", async () => {
  const { frame } = await show(showing(rows), { width: 80, height: 24 });
  expect(listPart(frame(), 401)).toContain(" 401 Plain story");
  expect(listPart(frame(), 402)).toContain(" 402 ⊗ Waits on another");
  expect(listPart(frame(), 403)).toContain(" 403 ▲ Holds up another");
  expect(listPart(frame(), 404)).toContain(" 404 ⊗ ▲ ↳ ▸3 Waits and holds up");
  expect(listPart(frame(), 405)).toMatch(/ 405 ⊗ ▲ Rework the\S* .*…/);
});

test("marked rows keep the same length and the age column stays aligned at every width", async () => {
  for (const width of [50, 62, 80, 100, 120]) {
    const { frame } = await show(showing(rows), { width, height: 24 });
    const shown = rows.map((row) => listPart(frame(), row.id));
    expect(new Set(shown.map((line) => line.length)).size).toBe(1);
    expect(new Set(shown.map((line) => line.trimEnd().slice(-6))).size).toBe(1);
    expect(
      frame()
        .split("\n")
        .every((line) => line.length <= width),
    ).toBe(true);
    cleanup();
  }
});

const colorOf = (screen: Rendered, row: number, glyph: string): RGBA | undefined =>
  screen
    .captureSpans()
    .lines[row]?.spans.find((span) => span.text.includes(glyph) && !span.text.includes("│"))?.fg;

test("the blocked mark takes the error color and the blocker mark the caution color", async () => {
  const { screen, frame } = await show(showing(rows), { width: 80, height: 24 });
  expect(colorOf(screen, rowIndex(frame(), 402), "⊗")).toEqual(RGBA.fromHex(colors.error));
  expect(colorOf(screen, rowIndex(frame(), 403), "▲")).toEqual(RGBA.fromHex(colors.caution));
});

test("the detail pane says whether the story is blocked or blocks another, before details load", async () => {
  const cases = [
    { story: blocked, field: "Blocking ⊗ blocked by another story Estimate" },
    { story: blocker, field: "Blocking ▲ blocks another story Estimate" },
    { story: both, field: "Blocking ⊗ blocked by another story · ▲ blocks another story Estimate" },
  ];
  for (const { story, field } of cases) {
    const { frame } = await show(showing([story]), { width: 80, height: 24 });
    expect(frame()).toContain("Loading details…");
    expect(detailText(frame())).toContain(field);
    cleanup();
  }
});

test("a story that neither is blocked nor blocks shows no Blocking field or mark", async () => {
  const { frame } = await show(showing([plain]), { width: 80, height: 24 });
  expect(frame()).toContain("State");
  expect(frame()).not.toContain("Blocking");
  expect(frame()).not.toContain("⊗");
  expect(frame()).not.toContain("▲");
});

test("the demo shows a blocked story and a blocker among your started stories at 80x24", async () => {
  const { frame } = await launchDemo();
  expect(frame()).toMatch(/ 1004 ⊗ Export iteration/);
  expect(frame()).toMatch(/ 1018 ▲ ↳ Stream audit/);
  expect(
    frame()
      .split("\n")
      .every((line) => line.length <= 80),
  ).toBe(true);
});
