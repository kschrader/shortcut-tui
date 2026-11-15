import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doing, summary, workflowState } from "../app/fixtures.ts";
import type { StartupList } from "../app/model.ts";
import { epicId } from "../shortcut/schemas.ts";
import {
  MAX_CACHE_AGE_MS,
  openStartupCache,
  readStartupList,
  startupListLocation,
  writeStartupList,
} from "./startup-list.ts";

const TOKEN = "sct_rw_acme_cachetest";
const OTHER_TOKEN = "sct_rw_acme_someoneelse";
const savedAt = new Date("2026-11-02T09:00:00.000Z");
const later = (ms: number) => new Date(savedAt.getTime() + ms);
const HOUR = 3_600_000;

const story = {
  ...summary(7, "Fix login redirect"),
  state: doing,
  estimate: 3,
  epic: { id: epicId.parse(8), name: "Auth" },
  parent: { id: summary(9).id, name: "Parent", appUrl: "https://app.shortcut.com/story/9" },
  updatedAt: new Date("2026-11-01T10:00:00.000Z"),
  movedAt: new Date("2026-10-30T10:00:00.000Z"),
  pullRequestCount: 2,
};
const list: StartupList = { mentionName: "kurt", savedAt, stories: [story, summary(11)] };

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "shortcut-tui-cache-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const at = (cacheHome: string, token = TOKEN) =>
  startupListLocation(token, { XDG_CACHE_HOME: cacheHome }, "/nonexistent-home");

const modeOf = (path: string) => statSync(path).mode & 0o777;

test("the file lives under $XDG_CACHE_HOME/shortcut-tui and is named by a hash of the token", () => {
  const hash = createHash("sha256").update(TOKEN).digest("hex").slice(0, 16);
  expect(at("/tmp/xdg")).toEqual({
    dir: "/tmp/xdg/shortcut-tui",
    file: `/tmp/xdg/shortcut-tui/story-list-${hash}.json`,
  });
});

test("without $XDG_CACHE_HOME the file lives under ~/.cache/shortcut-tui", () => {
  expect(startupListLocation(TOKEN, {}, "/home/ada").dir).toBe("/home/ada/.cache/shortcut-tui");
});

test("an empty or relative $XDG_CACHE_HOME is ignored, as the XDG spec says", () => {
  for (const XDG_CACHE_HOME of ["", "relative/cache"]) {
    expect(startupListLocation(TOKEN, { XDG_CACHE_HOME }, "/home/ada").dir).toBe(
      "/home/ada/.cache/shortcut-tui",
    );
  }
});

test("a different token gets a different file", () => {
  expect(at("/tmp/xdg").file).not.toBe(at("/tmp/xdg", OTHER_TOKEN).file);
});

test("a saved list reads back as it was saved", async () => {
  const location = at(scratch());
  await writeStartupList(location, list);
  expect(await readStartupList(location.file, later(HOUR))).toEqual(list);
});

test("the file never holds the token", async () => {
  const location = at(scratch());
  await writeStartupList(location, list);
  expect(readFileSync(location.file, "utf8")).not.toContain(TOKEN);
  expect(location.file).not.toContain(TOKEN);
});

test("another token never reads the list", async () => {
  const home = scratch();
  await writeStartupList(at(home), list);
  expect(await readStartupList(at(home, OTHER_TOKEN).file, later(HOUR))).toBeNull();
});

test("the file is readable only by its owner, and so is its directory", async () => {
  const location = at(scratch());
  await writeStartupList(location, list);
  expect(modeOf(location.file)).toBe(0o600);
  expect(modeOf(location.dir)).toBe(0o700);
});

test("an existing directory that others can read is narrowed to its owner", async () => {
  const location = at(scratch());
  mkdirSync(location.dir, { mode: 0o755 });
  chmodSync(location.dir, 0o755);
  await writeStartupList(location, list);
  expect(modeOf(location.dir)).toBe(0o700);
});

test("saving again replaces the list and leaves no temporary files", async () => {
  const location = at(scratch());
  await writeStartupList(location, list);
  const next = { ...list, stories: [summary(12)], savedAt: later(HOUR) };
  await writeStartupList(location, next);
  expect(await readStartupList(location.file, later(2 * HOUR))).toEqual(next);
  expect([...new Bun.Glob("*").scanSync(location.dir)]).toEqual([
    location.file.slice(location.dir.length + 1),
  ]);
});

const written = (contents: string) => {
  const location = at(scratch());
  mkdirSync(location.dir, { recursive: true });
  writeFileSync(location.file, contents);
  return location.file;
};

const asSaved = (overrides: Record<string, unknown>) =>
  JSON.stringify({ ...JSON.parse(JSON.stringify({ version: 1, ...list })), ...overrides });

test.each([
  ["is missing", () => join(scratch(), "nothing-here.json")],
  ["is not JSON", () => written("{ not json")],
  ["is empty", () => written("")],
  ["holds JSON of the wrong shape", () => written(JSON.stringify({ hello: "world" }))],
  ["has another version", () => written(asSaved({ version: 2 }))],
  ["has no version", () => written(asSaved({ version: undefined }))],
  ["has a story missing a field", () => written(asSaved({ stories: [{ id: 7, name: "x" }] }))],
  ["has a bad date", () => written(asSaved({ savedAt: "yesterday" }))],
  [
    "has a story in a state with an unknown progress",
    () =>
      written(
        asSaved({
          stories: [{ ...JSON.parse(JSON.stringify(story)), state: { ...doing, progress: "x" } }],
        }),
      ),
  ],
  ["is a directory", () => scratch()],
])("a cache file that %s is ignored", async (_, file) => {
  expect(await readStartupList(file(), later(HOUR))).toBeNull();
});

test("a list older than the age limit is ignored", async () => {
  const location = at(scratch());
  await writeStartupList(location, list);
  expect(await readStartupList(location.file, later(MAX_CACHE_AGE_MS))).toEqual(list);
  expect(await readStartupList(location.file, later(MAX_CACHE_AGE_MS + 1))).toBeNull();
});

test("the age limit is 7 days", () => {
  expect(MAX_CACHE_AGE_MS).toBe(7 * 24 * HOUR);
});

test("a stored workflow state keeps its workflow", async () => {
  const location = at(scratch());
  const review = workflowState(4, "In Review", "started", 3, { id: 2, name: "Design" });
  const reviewed = { ...list, stories: [{ ...story, state: review }] };
  await writeStartupList(location, reviewed);
  expect((await readStartupList(location.file, later(HOUR)))?.stories[0]?.state).toEqual(review);
});

test("an opened cache holds the saved list, and its save writes in order", async () => {
  const location = at(scratch());
  await writeStartupList(location, list);
  const cache = await openStartupCache(location, later(HOUR));
  expect(cache.list).toEqual(list);
  const first = { ...list, stories: [summary(21)] };
  const second = { ...list, stories: [summary(22)] };
  await Promise.all([cache.save(first), cache.save(second)]);
  expect(await readStartupList(location.file, later(HOUR))).toEqual(second);
});

test("a save that cannot write resolves and is ignored", async () => {
  const blocker = join(scratch(), "a-file");
  writeFileSync(blocker, "");
  const cache = await openStartupCache({ dir: blocker, file: join(blocker, "list.json") }, savedAt);
  expect(cache.list).toBeNull();
  expect(await cache.save(list)).toBeUndefined();
});
