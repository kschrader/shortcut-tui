import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createFakeClock } from "../app/fake-clock.ts";
import { useStoryBrowser } from "../app/runtime.ts";
import { createFakeGitHubClient } from "../github/fake.ts";
import { createFakeShortcutClient } from "../shortcut/fake.ts";
import { App } from "./App.tsx";

const MINUTE = 60_000;

let destroy = () => {};
afterEach(() => {
  destroy();
  destroy = () => {};
});

const launch = async () => {
  const clock = createFakeClock(new Date("2026-11-02T09:00:00Z"));
  const clients = { shortcut: createFakeShortcutClient(), github: createFakeGitHubClient() };
  const Root = () => {
    const { model, dispatch, now } = useStoryBrowser(clients, {
      clock,
      autoRefresh: { mode: "every", ms: 5 * MINUTE },
    });
    return <App model={model} now={now} dispatch={dispatch} quit={() => {}} openUrl={() => {}} />;
  };
  const screen = await testRender(<Root />, { width: 100, height: 30 });
  destroy = () => screen.renderer.destroy();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  const statusBar = () => screen.captureCharFrame().trimEnd().split("\n").at(-1) ?? "";
  const until = async (done: () => boolean) => {
    for (let turn = 0; turn < 100 && !done(); turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      await screen.renderOnce();
    }
    expect(done()).toBe(true);
  };
  return { clock, screen, statusBar, until };
};

test("the load time ages once a minute and resets when the interval refreshes the results", async () => {
  const { clock, screen, statusBar, until } = await launch();
  await until(() => statusBar().includes("↻ just now"));
  screen.mockInput.pressKey("j");
  await screen.renderOnce();
  const selectedRow = () =>
    screen
      .captureCharFrame()
      .split("\n")
      .find((line) => line.includes("▌"));
  const selected = selectedRow();
  clock.advance(2 * MINUTE);
  await until(() => statusBar().includes("↻ 2m ago"));
  clock.advance(3 * MINUTE);
  await until(() => statusBar().includes("↻ just now"));
  expect(selectedRow()).toBe(selected);
});

test("quitting the app clears the refresh timer and the render tick", async () => {
  const { clock, statusBar, until } = await launch();
  await until(() => statusBar().includes("↻ just now"));
  expect(clock.timers()).toBe(2);
  destroy();
  await new Promise((resolve) => setImmediate(resolve));
  expect(clock.timers()).toBe(0);
});
