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
  const clients = { shortcut: createFakeShortcutClient(), github: createFakeGitHubClient() };
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
  const screen = await testRender(<Root />, { width: 80, height: 30 });
  destroy = () => screen.renderer.destroy();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  const frame = () => screen.captureCharFrame();
  const header = () => frame().split("\n")[0] ?? "";
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
  return { frame, header, until, press };
};

test("the header names my started stories at startup", async () => {
  const { header } = await launch();
  expect(header()).toContain("my started stories");
});

test("f shows team stories waiting for review, without mine, and f again goes back", async () => {
  const { frame, header, until, press } = await launch();
  await press("f");
  await until(() => frame().includes("Paginate the iteration list"));
  expect(header()).toMatch(/Shortcut {2}\/ {2}waiting for review · team\s+2 stories/);
  expect(frame()).toContain("Fix flaky label sync test");
  expect(frame()).not.toContain("Rate-limit integration retries");
  expect(frame()).not.toContain("Login redirect drops the return URL");
  await press("f");
  await until(() => frame().includes("Login redirect drops the return URL"));
  expect(header()).toContain("my started stories");
});

test("/ from the review view starts an empty query", async () => {
  const { frame, header, until, press } = await launch();
  await press("f");
  await until(() => frame().includes("Paginate the iteration list"));
  await press("/");
  expect(header()).toContain("search stories");
});
