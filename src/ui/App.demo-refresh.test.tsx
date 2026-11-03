import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createFakeClock } from "../app/fake-clock.ts";
import { useStoryBrowser } from "../app/runtime.ts";
import { createFakeGitHubClient } from "../github/fake.ts";
import { createFakeShortcutClient } from "../shortcut/fake.ts";
import { App } from "./App.tsx";

let destroy = () => {};
afterEach(() => {
  destroy();
  destroy = () => {};
});

const launch = async () => {
  const clock = createFakeClock(new Date("2026-11-02T09:00:00Z"));
  const clients = {
    shortcut: createFakeShortcutClient({ teammateMovesOnRefresh: true }),
    github: createFakeGitHubClient(),
  };
  const Root = () => {
    const { model, dispatch, now } = useStoryBrowser(clients, {
      clock,
      autoRefresh: { mode: "off" },
    });
    return (
      <App
        model={model}
        now={now}
        dispatch={dispatch}
        quit={() => {}}
        openUrl={() => {}}
        copyText={() => true}
      />
    );
  };
  const screen = await testRender(<Root />, { width: 80, height: 24 });
  destroy = () => screen.renderer.destroy();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  const frame = () => screen.captureCharFrame();
  const until = async (done: () => boolean) => {
    for (let turn = 0; turn < 100 && !done(); turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      await screen.renderOnce();
    }
    expect(done()).toBe(true);
  };
  const press = async (key: string) => {
    screen.mockInput.pressKey(key);
    await screen.renderOnce();
  };
  await until(() => frame().includes("Login redirect drops the return URL"));
  return { frame, until, press };
};

const rowOf = (frame: string, id: number) =>
  frame.split("\n").find((line) => line.includes(` ${String(id)} `)) ?? "";

test("in the demo, a refresh after a teammate moved a story marks it until you look at it", async () => {
  const { frame, until, press } = await launch();
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
