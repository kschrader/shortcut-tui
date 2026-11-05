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
  await until(() => frame().includes("Login redirect drops the return"));
  return { frame, header, until, press };
};

test("the header names my started stories at startup", async () => {
  const { header } = await launch();
  expect(header()).toContain("my started stories");
});

test("f shows team stories waiting for review, without mine, then merged work, then goes back", async () => {
  const { frame, header, until, press } = await launch();
  await press("f");
  await until(() => frame().includes("Paginate the iteration list"));
  expect(header()).toMatch(/Shortcut {2}\/ {2}waiting for review · team\s+2 stories/);
  expect(frame()).toContain("Fix flaky label sync test");
  expect(frame()).not.toContain("Rate-limit integration retries");
  expect(frame()).not.toContain("Login redirect drops the return");
  await press("f");
  await until(() => header().includes("merged, not moved · team"));
  await press("f");
  await until(() => frame().includes("Login redirect drops the return"));
  expect(header()).toContain("my started stories");
});

test("the demo review view marks the story whose pull request asks for your review", async () => {
  const { frame, header, until, press } = await launch();
  await press("f");
  await until(() => frame().includes("@●   1010 Paginate the iteration list"));
  expect(frame()).toMatch(/ {2}■ {3}1011 Fix flaky label sync test\s+5w /);
  expect(header()).toMatch(/2 stories {2}· {2}1 for you/);
});

test("/ from the review view starts an empty query", async () => {
  const { frame, header, until, press } = await launch();
  await press("f");
  await until(() => frame().includes("Paginate the iteration list"));
  await press("/");
  expect(header()).toContain("search stories");
});

const dividers = (text: string) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("──"))
    .map((line) => (line.split("│")[0] ?? "").replace(/ ─+\s*$/, ""));

test("the review view groups stories under each owner, shared stories under their owners together", async () => {
  const { frame, until, press } = await launch();
  await press("f");
  await until(() => frame().includes("Paginate the iteration list"));
  expect(dividers(frame())).toEqual(["── Priya Shah  1", "── Priya Shah + Sam Okafor  1"]);
  const lines = frame().split("\n");
  const rowOf = (needle: string) => lines.findIndex((line) => line.includes(needle));
  expect(rowOf("── Priya Shah  1")).toBeLessThan(rowOf("Paginate the iteration list"));
  expect(rowOf("Paginate the iteration list")).toBeLessThan(rowOf("── Priya Shah + Sam"));
  expect(rowOf("── Priya Shah + Sam")).toBeLessThan(rowOf("Fix flaky label sync test"));
});

test("my stories keep their workflow state dividers", async () => {
  const { frame } = await launch();
  expect(dividers(frame())).toEqual([
    "── In Review  2  · Engineering",
    "── In Progress  2  · Engineering",
  ]);
});

test("a narrows each demo view to stories 4 weeks or more in their state, and a again lifts it", async () => {
  const { frame, header, until, press } = await launch();
  await press("a");
  await until(() => header().includes("1 story"));
  expect(header()).toMatch(/my started stories {2}· 4w\+\s+1 story/);
  expect(frame()).toContain("Document webhook retry behavior");
  expect(frame()).not.toContain("Login redirect drops the return");
  await press("f");
  await until(() => frame().includes("Fix flaky label sync test"));
  expect(header()).toMatch(/waiting for review · team {2}· 4w\+\s+1 story/);
  expect(frame()).not.toContain("Paginate the iteration list");
  await press("a");
  await until(() => frame().includes("Paginate the iteration list"));
  expect(header()).not.toContain("4w+");
});
