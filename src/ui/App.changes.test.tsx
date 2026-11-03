import { afterEach, expect, test } from "bun:test";
import { glanceOf } from "../app/glance.ts";
import type { Model, Msg } from "../app/model.ts";
import { update } from "../app/update.ts";
import { browsing, cleanup, inProgress, show, stories, storyId } from "./frame.tsx";

afterEach(cleanup);

const [fixLogin, darkMode, rotateKeys] = stories;

const afterRefresh = (): Model => {
  const model = browsing();
  const seen = new Map(model.seen).set(rotateKeys.id, {
    ...glanceOf(rotateKeys, model.pullRequests),
    state: inProgress,
  });
  return { ...model, seen };
};

const rowOf = (frame: string, id: number) =>
  frame.split("\n").find((line) => line.includes(` ${String(id)} `)) ?? "";

const apply = (model: Model, msg: Msg): Model => update(model, msg)[0];

test("a story that changed while you were away gets a gutter mark and the header counts it", async () => {
  const { frame } = await show(afterRefresh());
  const text = frame();
  expect(rowOf(text, rotateKeys.id).trimStart().startsWith("•")).toBe(true);
  expect(rowOf(text, fixLogin.id)).not.toContain("•");
  expect(rowOf(text, darkMode.id)).toContain("▌");
  expect(text.split("\n")[0]).toContain("3 stories  ·  1 updated");
  expect(text).not.toContain("Changed since you last looked");
});

test("a frame with nothing changed shows no marks and no count", async () => {
  const { frame } = await show(browsing());
  expect(frame()).not.toContain("•");
  expect(frame()).not.toContain("updated");
});

test("selecting a marked story says what changed, and moving on clears its mark", async () => {
  const model = afterRefresh();
  const { frame, rerender } = await show(model, { width: 200 });
  const looking = apply(model, { type: "storyClicked", storyId: rotateKeys.id });
  await rerender(looking);
  const text = frame();
  expect(text).toContain("Changed since you last looked: state In Progress → Ready");
  expect(rowOf(text, rotateKeys.id)).toContain("▌");
  expect(text).not.toContain("•");
  expect(text.split("\n")[0]).not.toContain("updated");

  await rerender(apply(looking, { type: "storyClicked", storyId: fixLogin.id }));
  const left = frame();
  expect(rowOf(left, rotateKeys.id)).not.toContain("•");
  expect(left).not.toContain("Changed since you last looked");
  expect(left.split("\n")[0]).not.toContain("updated");
});

test("the detail line names a new story, a pull request change and an edit", async () => {
  const model = browsing();
  const lines = async (seen: Model["seen"], selected: number) => {
    const { frame } = await show(
      { ...model, seen, selectedStoryId: storyId(selected) },
      { width: 200 },
    );
    const found = frame()
      .split("\n")
      .find((line) => line.includes("Changed since you last looked"));
    cleanup();
    return found ?? "";
  };
  const { seen } = model;
  const without = new Map(seen);
  without.delete(rotateKeys.id);
  expect(await lines(without, 103)).toContain("Changed since you last looked: new in this list");
  const glance = glanceOf(darkMode, model.pullRequests);
  expect(
    await lines(new Map(seen).set(darkMode.id, { ...glance, mergeStatus: "checks-running" }), 102),
  ).toContain("Changed since you last looked: pull requests checks running → none");
  expect(
    await lines(new Map(seen).set(darkMode.id, { ...glance, updatedAt: new Date(0) }), 102),
  ).toContain("Changed since you last looked: edited");
});

test("at 80 columns the marked row and the header count still fit", async () => {
  const { frame } = await show(afterRefresh(), { width: 80, height: 24 });
  const lines = frame().split("\n");
  expect(lines[0]).toContain("owner:me");
  expect(lines[0]).toContain("3 stories  ·  1 updated");
  expect(rowOf(frame(), rotateKeys.id).trimStart().startsWith("•")).toBe(true);
  expect(rowOf(frame(), rotateKeys.id)).toContain("Rotate API keys");
  for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
});
