import { afterEach, expect, test } from "bun:test";
import { cleanup, launchDemo } from "./frame.tsx";

afterEach(cleanup);

const rowOf = (frame: string, id: number) =>
  frame.split("\n").find((line) => line.includes(` ${String(id)} `)) ?? "";

test("in the demo, a refresh after a teammate moved a story marks it until you look at it", async () => {
  const { frame, until, press } = await launchDemo();
  expect(frame()).not.toContain("updated");
  await press("r");
  await until(() => frame().split("\n")[0]?.includes("1 updated") ?? false);
  expect(rowOf(frame(), 1001).startsWith("•")).toBe(true);
  const rows = frame().split("\n");
  const target = rows.findIndex((line) => line.includes(" 1001 "));
  const selected = rows.findIndex((line) => line.startsWith("▌"));
  for (let step = 0; step < Math.abs(target - selected); step += 1) {
    await press(target > selected ? "j" : "k");
  }
  await until(() => rowOf(frame(), 1001).startsWith("▌"));
  await until(() => frame().includes("Changed since you last"));
  expect(frame()).toContain("Progress → In Review");
  expect(frame().split("\n")[0]).not.toContain("updated");
  await press(target > selected ? "k" : "j");
  await until(() => !rowOf(frame(), 1001).startsWith("▌"));
  expect(rowOf(frame(), 1001).startsWith(" ")).toBe(true);
  expect(frame()).not.toContain("Changed since you last");
});
