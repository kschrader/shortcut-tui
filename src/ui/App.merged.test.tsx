import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { z } from "zod";
import { createFakeClock } from "../app/fake-clock.ts";
import { withoutFloor } from "../app/filters.ts";
import type { PullRequestView, SearchResults, StoryPullRequests } from "../app/model.ts";
import { useStoryBrowser } from "../app/runtime.ts";
import { noStartupCache } from "../app/store.ts";
import { createFakeGitHubClient } from "../github/fake.ts";
import type { PullRequestState } from "../github/types.ts";
import { createFakeShortcutClient } from "../shortcut/fake.ts";
import type { PullRequestId } from "../shortcut/types.ts";
import { App } from "./App.tsx";
import {
  ada,
  cached,
  cleanup,
  grace,
  inProgress,
  loaded,
  modelWith,
  reloadFailed,
  reloading,
  requestId,
  settled,
  show,
  storyId,
  summary,
} from "./frame.tsx";

let destroy = () => {};
afterEach(() => {
  destroy();
  destroy = () => {};
  cleanup();
});

const launchDemo = async () => {
  const clock = createFakeClock(new Date("2026-11-02T09:00:00Z"));
  const clients = { shortcut: createFakeShortcutClient(), github: createFakeGitHubClient() };
  const Root = () => {
    const { model, dispatch, now } = useStoryBrowser(clients, {
      clock,
      autoRefresh: { mode: "off" },
      startupCache: noStartupCache,
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
  return { frame, until, press };
};

const lines = (frame: string) => frame.split("\n");

test("the demo's third filter lists every owner's started stories whose pull requests merged", async () => {
  const { frame, until, press } = await launchDemo();
  await press("f");
  await until(() => frame().includes("Paginate the iteration list"));
  await press("f");
  await until(() => frame().includes("Resend failed deliveries"));
  const [header = "", ...rest] = lines(frame());
  expect(header).toMatch(/Shortcut {2}\/ {2}merged, not moved · team\s+2 stories/);
  const dividers = rest
    .map((line) => line.split("│")[0] ?? "")
    .filter((line) => line.startsWith("──"))
    .map((line) => line.replace(/ ─+\s*$/, ""));
  expect(dividers).toEqual(["── Alex Rivera  1", "── Sam Okafor  1"]);
  expect(frame()).toContain("▌●   1012 Resend failed deliveries from t…  4w ◉  3 │");
  expect(frame()).toContain(" ◆   1013 Trim whitespace in imported sto…  2w ◉  1 │");
  expect(frame()).not.toContain("Cache iteration burndown");
  expect(frame()).not.toContain("Export iteration report");
  expect(frame()).not.toContain("@");
});

const dividersOf = (frame: string) =>
  lines(frame)
    .slice(1)
    .map((line) => line.split("│")[0] ?? "")
    .filter((line) => line.startsWith("──"))
    .map((line) => line.replace(/ ─+\s*$/, ""));

test("moving the selected story to Done takes its row and owner group out once Shortcut confirms, and selects the next row, at 80 columns", async () => {
  const { frame, until, press } = await launchDemo();
  await press("f");
  await until(() => frame().includes("Paginate the iteration list"));
  await press("f");
  await until(() => frame().includes("Resend failed deliveries"));
  expect(lines(frame())[0]).toMatch(/merged, not moved · team\s+2 stories/);
  expect(dividersOf(frame())).toEqual(["── Alex Rivera  1", "── Sam Okafor  1"]);
  expect(frame()).toContain("▌●   1012 Resend failed deliveries from t…");
  await press("m");
  await until(() => frame().includes("Move 1012"));
  await press("j");
  await press("j");
  expect(frame()).toMatch(/▌\s+Done/);
  await press("\r");
  await until(() => !frame().includes("Resend failed deliveries"));
  expect(lines(frame())[0]).toMatch(/merged, not moved · team\s+1 story/);
  expect(dividersOf(frame())).toEqual(["── Sam Okafor  1"]);
  expect(frame()).toContain("▌◆   1013 Trim whitespace in imported sto…  2w ◉  1 │");
  await until(() => frame().includes("Trim titles in the CSV"));
});

const view = (number: number, state: PullRequestState): PullRequestView => ({
  id: z.custom<PullRequestId>().parse(number),
  title: `Pull request ${String(number)}`,
  url: `https://github.com/acme/app/pull/${String(number)}`,
  closed: false,
  draft: false,
  github: { owner: "acme", repo: "app", number },
  state,
  reviews: null,
  optionalFailing: [],
});

const merged = withoutFloor({ kind: "mergedNotMoved" });

const linking = [
  summary(201, {
    name: "Ship the importer",
    owners: [ada],
    state: inProgress,
    pullRequestCount: 1,
  }),
  summary(202, {
    name: "Spike on caching",
    owners: [grace],
    state: inProgress,
    pullRequestCount: 1,
  }),
];

const searched = (): SearchResults => ({ question: merged, stories: linking, cachedAt: null });

const statuses = (first: PullRequestState, second: PullRequestState): StoryPullRequests =>
  new Map([
    [storyId(201), settled<readonly PullRequestView[]>([view(1, first)])],
    [storyId(202), settled<readonly PullRequestView[]>([view(2, second)])],
  ]);

test("while GitHub has not answered, the list says it is checking instead of showing every story", async () => {
  const { frame } = await show(
    modelWith({
      question: merged,
      results: loaded(searched()),
      pullRequests: cached(new Map(), reloading(requestId(4))),
    }),
    { width: 80 },
  );
  expect(lines(frame())[0]).toMatch(/merged, not moved · team\s+loading…/);
  expect(frame()).toContain("Checking 2 stories' pull requests…");
  expect(frame()).toContain("Asking GitHub which are merged");
  expect(frame()).not.toContain("Ship the importer");
});

test("with nothing merged, the list says so and the header counts no stories", async () => {
  const { frame } = await show(
    modelWith({
      question: merged,
      results: loaded(searched()),
      pullRequests: cached(statuses("ready", "closed")),
    }),
    { width: 80 },
  );
  expect(lines(frame())[0]).toMatch(/merged, not moved · team\s+0 stories/);
  expect(frame()).toContain("Nothing merged and left open");
  expect(frame()).not.toContain("No stories match");
  expect(frame()).not.toContain("Press / to change the query");
});

test("when GitHub cannot be asked at all, the list says the filter needs it", async () => {
  const { frame } = await show(
    modelWith({
      question: merged,
      results: loaded(searched()),
      pullRequests: cached(new Map(), reloadFailed("gh: command not found")),
    }),
    { width: 80 },
  );
  expect(lines(frame())[0]).toMatch(/merged, not moved · team\s+error/);
  expect(frame()).toContain("Could not check pull requests");
  expect(frame()).toContain("This filter needs GitHub through gh  ·  press r to retry");
  expect(frame()).toContain("✗ PR status: gh: command not found  ·  r to retry");
});

test("a refresh keeps the shown rows while GitHub answers again", async () => {
  const { frame } = await show(
    modelWith({
      question: merged,
      results: loaded(searched()),
      selectedStoryId: storyId(201),
      pullRequests: cached(statuses("merged", "ready"), reloading(requestId(9))),
    }),
    { width: 80 },
  );
  expect(frame()).toContain("Ship the importer");
  expect(frame()).not.toContain("Spike on caching");
  expect(frame()).not.toContain("Checking");
});
