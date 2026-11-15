import { RGBA } from "@opentui/core";
import { afterEach, expect, test } from "bun:test";
import { queryQuestion } from "../app/filters.ts";
import type { StoryDetail } from "../shortcut/types.ts";
import { browsing, cleanup, detail, done, launchDemo, loaded, show, summary } from "./frame.tsx";
import { colors } from "./theme.ts";

afterEach(cleanup);

const story = summary(501, { name: "Ship the release", estimate: null });

const item = (id: number, description: string, completed: boolean) => ({
  id,
  description,
  completed,
});

const withChecklist = (overrides: Partial<StoryDetail> = {}): StoryDetail => ({
  ...detail,
  ...story,
  labels: [],
  comments: [],
  checklist: [
    item(1, "Write release notes", true),
    item(2, "Tag the build", false),
    item(3, "Tell support", true),
    item(4, "Post the changelog", false),
  ],
  ...overrides,
});

const opened = (shown: StoryDetail) =>
  show(
    browsing({
      results: loaded({ question: queryQuestion("owner:me"), stories: [story] }),
      selectedStoryId: story.id,
      details: new Map([[story.id, loaded(shown)]]),
    }),
    { width: 80, height: 24 },
  );

const detailText = (frame: string) =>
  frame
    .split("\n")
    .map((line) =>
      line
        .slice(line.indexOf("│") + 1)
        .replace(/[█▀▄]/g, "")
        .trim(),
    )
    .join(" ")
    .replace(/ +/g, " ");

test("the detail pane counts done checklist items and lists every item in order at 80x24", async () => {
  const { frame } = await opened(withChecklist());
  const text = detailText(frame());
  expect(text).toContain(
    "Checklist (2/4 done) ✓ Write release notes ○ Tag the build ✓ Tell support ○ Post the changelog",
  );
  expect(text.indexOf("Labels")).toBeLessThan(text.indexOf("Checklist"));
  expect(text.indexOf("Checklist")).toBeLessThan(text.indexOf("Description"));
});

test("the checklist follows the sub-tasks", async () => {
  const { frame } = await show(
    browsing({
      results: loaded({ question: queryQuestion("owner:me"), stories: [story] }),
      selectedStoryId: story.id,
      details: new Map([
        [
          story.id,
          loaded(
            withChecklist({
              subTasks: [summary(502, { name: "Child", state: done })],
              checklist: [item(1, "Only item", false)],
            }),
          ),
        ],
      ]),
    }),
    { width: 80, height: 30 },
  );
  const text = detailText(frame());
  expect(text).toContain("Sub-tasks (1/1 done)");
  expect(text).toContain("Checklist (0/1 done) ○ Only item");
  expect(text.indexOf("Sub-tasks")).toBeLessThan(text.indexOf("Checklist"));
});

test("a done item's mark takes the ok color and an open item's the dim color", async () => {
  const { screen, frame } = await opened(withChecklist());
  const lines = frame().split("\n");
  const colorBefore = (description: string) => {
    const row = lines.findIndex((line) => line.includes(description));
    return screen
      .captureSpans()
      .lines[row]?.spans.find((span) => span.text.includes("✓") || span.text.includes("○"))?.fg;
  };
  expect(colorBefore("Write release notes")).toEqual(RGBA.fromHex(colors.ok));
  expect(colorBefore("Tag the build")).toEqual(RGBA.fromHex(colors.dim));
});

test("a story with no checklist items has no section", async () => {
  const { frame } = await opened(withChecklist({ checklist: [] }));
  expect(frame()).toContain("Description");
  expect(frame()).not.toContain("Checklist");
});

test("the demo shows a part-done checklist on the first selected story", async () => {
  const { frame, until } = await launchDemo({ height: 60 });
  await until(() => frame().includes("Checklist (2/4 done)"));
  const text = detailText(frame());
  expect(text).toContain(
    "✓ Pick the report columns ✓ Quote fields that contain commas ○ Add the download button ○ Try a 500-story iteration",
  );
});
