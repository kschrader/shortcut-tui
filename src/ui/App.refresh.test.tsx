import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { createFakeClock } from "../app/fake-clock.ts";
import { useStoryBrowser } from "../app/runtime.ts";
import { noStartupCache } from "../app/store.ts";
import { createFakeGitHubClient } from "../github/fake.ts";
import { createFakeShortcutClient } from "../shortcut/fake.ts";
import { storyId } from "../shortcut/schemas.ts";
import { App } from "./App.tsx";

const MINUTE = 60_000;

let destroy = () => {};
afterEach(() => {
  destroy();
  destroy = () => {};
});

type Outcome = { kind: "pass" } | { kind: "reject"; message: string };

const gate = () => {
  let held: PromiseWithResolvers<Outcome> | null = null;
  return {
    hold() {
      held = Promise.withResolvers<Outcome>();
    },
    async pass<T>(value: T): Promise<T> {
      const waiting = held;
      if (waiting === null) return value;
      const outcome = await waiting.promise;
      if (outcome.kind === "reject") throw new Error(outcome.message);
      return value;
    },
    release() {
      held?.resolve({ kind: "pass" });
      held = null;
    },
    reject(message: string) {
      held?.resolve({ kind: "reject", message });
      held = null;
    },
  };
};

const newlyLinked = storyId.parse(1002);

const launch = async () => {
  const clock = createFakeClock(new Date("2026-11-02T09:00:00Z"));
  const shortcut = createFakeShortcutClient();
  const github = createFakeGitHubClient();
  const searchGate = gate();
  const detailGate = gate();
  const githubGate = gate();
  const searches: string[] = [];
  const copied: string[] = [];
  const clients = {
    shortcut: {
      ...shortcut,
      async searchStories(query: string) {
        searches.push(query);
        const found = await shortcut.searchStories(query);
        const refreshed =
          searches.length > 1 ? [...found, await shortcut.getStory(newlyLinked)] : found;
        return searchGate.pass(refreshed);
      },
      getStory: (id: Parameters<typeof shortcut.getStory>[0]) =>
        shortcut.getStory(id).then((story) => detailGate.pass(story)),
    },
    github: {
      pullRequests: (refs: Parameters<typeof github.pullRequests>[0]) =>
        github.pullRequests(refs).then((answers) => githubGate.pass(answers)),
    },
  };
  const Root = () => {
    const { model, dispatch, now } = useStoryBrowser(clients, {
      clock,
      autoRefresh: { mode: "every", ms: 5 * MINUTE },
      startupCache: noStartupCache,
    });
    return (
      <App
        model={model}
        now={now}
        dispatch={dispatch}
        quit={() => {}}
        openUrl={() => {}}
        copyText={(text) => {
          copied.push(text);
          return true;
        }}
      />
    );
  };
  const screen = await testRender(<Root />, { width: 120, height: 40 });
  destroy = () => screen.renderer.destroy();
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  const frame = () => screen.captureCharFrame();
  const lines = () => frame().trimEnd().split("\n");
  const header = () => lines()[0] ?? "";
  const statusBar = () => lines().at(-1) ?? "";
  const rowOf = (id: number) => lines().find((line) => line.includes(` ${String(id)} `)) ?? "";
  const selectedRow = () => lines().find((line) => line.includes("▌")) ?? "";
  const until = async (done: () => boolean) => {
    for (let turn = 0; turn < 100 && !done(); turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      await screen.renderOnce();
    }
  };
  const press = async (key: string) => {
    screen.mockInput.pressKey(key);
    await screen.renderOnce();
  };
  await until(
    () => rowOf(1001).includes("CI failing") && frame().includes("Managers want to pull"),
  );
  expect(selectedRow()).toContain("1004");
  return {
    clock,
    searches,
    copied,
    searchGate,
    detailGate,
    githubGate,
    frame,
    header,
    statusBar,
    rowOf,
    selectedRow,
    until,
    press,
  };
};

test("r keeps the list on screen while the search is out, then swaps in the answer", async () => {
  const { searchGate, frame, header, selectedRow, until, press } = await launch();
  searchGate.hold();
  await press("r");
  await until(() => header().includes("loading…"));
  expect(header()).toContain("loading…");
  expect(frame()).toContain("Export iteration report as CSV");
  expect(frame()).not.toContain("Loading stories…");
  searchGate.release();
  await until(() => frame().includes("Add keyboard shortcuts cheat sheet"));
  expect(frame()).toContain("Add keyboard shortcuts cheat sheet");
  expect(header()).not.toContain("loading…");
  expect(selectedRow()).toContain("1004");
});

test("r keeps the selected story's detail while it reloads", async () => {
  const { detailGate, frame, header, until, press } = await launch();
  detailGate.hold();
  await press("r");
  await until(() => !header().includes("loading…"));
  expect(frame()).toContain("Managers want to pull");
  expect(frame()).not.toContain("Loading details…");
  detailGate.release();
});

test("a story keeps its badge while pull request status reloads, and a new one says checking", async () => {
  const { githubGate, rowOf, until, press } = await launch();
  githubGate.hold();
  await press("r");
  await until(() => rowOf(1002) !== "");
  expect(rowOf(1001)).toContain("CI failing");
  expect(rowOf(1001)).not.toContain("checking");
  expect(rowOf(1002)).toContain("… checking");
  githubGate.release();
  await until(() => rowOf(1002).includes("behind"));
  expect(rowOf(1002)).toContain("↓ behind");
});

test("a failed refresh keeps the list and reports the failure in the status bar", async () => {
  const { searchGate, frame, header, statusBar, until, press } = await launch();
  searchGate.hold();
  await press("r");
  await until(() => header().includes("loading…"));
  searchGate.reject("HTTP 503");
  await until(() => !header().includes("loading…"));
  expect(frame()).toContain("Export iteration report as CSV");
  expect(frame()).not.toContain("Search failed");
  expect(statusBar()).toContain("Refresh failed");
  expect(statusBar()).toContain("r to retry");
  expect(statusBar()).toContain("HTTP 503");
});

test("the auto-refresh keeps the list on screen and does not stack a second search", async () => {
  const { clock, searches, searchGate, frame, header, until } = await launch();
  searchGate.hold();
  clock.advance(5 * MINUTE);
  await until(() => header().includes("loading…"));
  expect(searches.length).toBe(2);
  expect(frame()).toContain("Export iteration report as CSV");
  expect(frame()).not.toContain("Loading stories…");
  clock.advance(5 * MINUTE);
  await until(() => searches.length > 2);
  expect(searches.length).toBe(2);
  searchGate.release();
  await until(() => !header().includes("loading…"));
  expect(frame()).toContain("Add keyboard shortcuts cheat sheet");
});

test("j and y act on the shown list while a refresh is out", async () => {
  const { copied, searchGate, header, selectedRow, until, press } = await launch();
  searchGate.hold();
  await press("r");
  await until(() => header().includes("loading…"));
  await press("j");
  expect(selectedRow()).toContain("1009");
  await press("y");
  expect(copied).toEqual(["https://app.shortcut.com/demo/story/1009"]);
  searchGate.release();
});
