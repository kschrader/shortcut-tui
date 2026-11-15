import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openStartupCache,
  readStartupList,
  startupListLocation,
  writeStartupList,
} from "../cache/startup-list.ts";
import { createFakeGitHubClient } from "../github/fake.ts";
import { createFakeShortcutClient } from "../shortcut/fake.ts";
import type { AutoRefresh } from "./auto-refresh.ts";
import { createFakeClock } from "./fake-clock.ts";
import { summary } from "./fixtures.ts";
import type { Model } from "./model.ts";
import { awaited, inFlight } from "./remote.ts";
import { createStoryStore, noStartupCache } from "./store.ts";

const MINUTE = 60_000;
const every5Minutes: AutoRefresh = { mode: "every", ms: 5 * MINUTE };

const loading = (model: Model) =>
  awaited(model.workspace) !== null ||
  awaited(model.results) !== null ||
  inFlight(model.pullRequests.reload) !== null ||
  [...model.details.values()].some((detail) => awaited(detail) !== null);

const started = async (autoRefresh: AutoRefresh = every5Minutes) => {
  const clock = createFakeClock(new Date("2026-11-02T09:00:00Z"));
  const shortcut = createFakeShortcutClient();
  const searches: string[] = [];
  const store = createStoryStore(
    {
      shortcut: {
        ...shortcut,
        searchStories: (query) => {
          searches.push(query);
          return shortcut.searchStories(query);
        },
      },
      github: createFakeGitHubClient(),
    },
    { clock, autoRefresh, startupCache: noStartupCache },
  );
  const settle = async () => {
    for (let turn = 0; turn < 100 && loading(store.getModel()); turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(loading(store.getModel())).toBe(false);
  };
  const stop = store.start();
  await settle();
  return { clock, store, searches, settle, stop };
};

test("searches again each time the interval passes", async () => {
  const { clock, searches, settle, stop } = await started();
  expect(searches.length).toBe(1);
  clock.advance(5 * MINUTE - 1);
  expect(searches.length).toBe(1);
  clock.advance(1);
  await settle();
  expect(searches.length).toBe(2);
  clock.advance(5 * MINUTE);
  await settle();
  expect(searches).toEqual([searches[0], searches[0], searches[0]]);
  stop();
});

test("results record when they arrived by the store's clock", async () => {
  const { clock, store, settle, stop } = await started();
  expect(store.getModel().loadedAt).toEqual(new Date("2026-11-02T09:00:00Z"));
  clock.advance(5 * MINUTE);
  await settle();
  expect(store.getModel().loadedAt).toEqual(new Date("2026-11-02T09:05:00Z"));
  stop();
});

test("stopping the store clears its timer, and a later r does not start another", async () => {
  const { clock, store, searches, stop } = await started();
  expect(clock.timers()).toBe(1);
  stop();
  expect(clock.timers()).toBe(0);
  store.dispatch({ type: "refreshRequested" });
  expect(clock.timers()).toBe(0);
  clock.advance(60 * MINUTE);
  expect(searches.length).toBe(2);
});

test("r restarts the countdown, so no automatic refresh follows it seconds later", async () => {
  const { clock, store, searches, settle, stop } = await started();
  clock.advance(4 * MINUTE);
  store.dispatch({ type: "refreshRequested" });
  await settle();
  expect(searches.length).toBe(2);
  clock.advance(4 * MINUTE);
  await settle();
  expect(searches.length).toBe(2);
  clock.advance(1 * MINUTE);
  await settle();
  expect(searches.length).toBe(3);
  expect(clock.timers()).toBe(1);
  stop();
});

test("a tick while the user edits the query is skipped, and the next tick refreshes", async () => {
  const { clock, store, searches, settle, stop } = await started();
  store.dispatch({ type: "queryEditStarted" });
  clock.advance(5 * MINUTE);
  await settle();
  expect(searches.length).toBe(1);
  store.dispatch({ type: "queryEditCancelled" });
  clock.advance(5 * MINUTE);
  await settle();
  expect(searches.length).toBe(2);
  stop();
});

test("with auto-refresh off the store never starts a timer", async () => {
  const { clock, searches, stop } = await started({ mode: "off" });
  expect(clock.timers()).toBe(0);
  clock.advance(24 * 60 * MINUTE);
  expect(searches.length).toBe(1);
  stop();
});

test("the store starts on the saved startup list and saves the first answer over it", async () => {
  const cacheHome = mkdtempSync(join(tmpdir(), "shortcut-tui-store-"));
  const location = startupListLocation("sct_rw_store_test", { XDG_CACHE_HOME: cacheHome }, "/");
  const savedAt = new Date("2026-11-02T08:00:00Z");
  await writeStartupList(location, { mentionName: "demo", savedAt, stories: [summary(901)] });
  const clock = createFakeClock(new Date("2026-11-02T09:00:00Z"));
  const store = createStoryStore(
    { shortcut: createFakeShortcutClient(), github: createFakeGitHubClient() },
    {
      clock,
      autoRefresh: { mode: "off" },
      startupCache: await openStartupCache(location, clock.now()),
    },
  );
  expect(store.getModel().results).toMatchObject({ value: { cachedAt: savedAt } });
  const stop = store.start();
  for (let turn = 0; turn < 100 && loading(store.getModel()); turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const { results } = store.getModel();
  if (results.status !== "loaded") throw new Error("the first search did not answer");
  expect(results.value.cachedAt).toBeNull();
  const savedAgain = async () => {
    for (let turn = 0; turn < 100; turn += 1) {
      const list = await readStartupList(location.file, clock.now());
      if (list?.savedAt.getTime() === clock.now().getTime()) return list;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return null;
  };
  const fresh = await savedAgain();
  expect(fresh?.stories.length).toBeGreaterThan(0);
  expect(fresh?.stories).toEqual(results.value.stories);
  stop();
  rmSync(cacheHome, { recursive: true, force: true });
});
