import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { StartupList } from "../app/model.ts";
import type { StartupCache } from "../app/store.ts";
import { epicId, memberId, storyId, workflowId, workflowStateId } from "../shortcut/schemas.ts";
import type { MemberRef, StoryRef, StorySummary, WorkflowState } from "../shortcut/types.ts";

export const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const VERSION = 1;

const timestamp = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const workflowState = z.object({
  id: workflowStateId,
  name: z.string(),
  progress: z.enum(["unstarted", "started", "done"]),
  position: z.number(),
  workflow: z.object({ id: workflowId, name: z.string() }),
}) satisfies z.ZodType<WorkflowState>;

const memberRef = z.object({ id: memberId, name: z.string() }) satisfies z.ZodType<MemberRef>;

const storyRef = z.object({
  id: storyId,
  name: z.string(),
  appUrl: z.string(),
}) satisfies z.ZodType<StoryRef>;

const storySummary = z.object({
  id: storyId,
  name: z.string(),
  storyType: z.enum(["feature", "bug", "chore"]),
  state: workflowState,
  estimate: z.number().nullable(),
  owners: z.array(memberRef),
  epic: z.object({ id: epicId, name: z.string() }).nullable(),
  appUrl: z.string(),
  branchName: z.string().nullable(),
  updatedAt: timestamp,
  movedAt: timestamp,
  pullRequestCount: z.number().int().nonnegative(),
  parent: storyRef.nullable(),
  subTaskCount: z.number().int().nonnegative(),
}) satisfies z.ZodType<StorySummary>;

const StartupListFile = z.object({
  version: z.literal(VERSION),
  mentionName: z.string(),
  savedAt: timestamp,
  stories: z.array(storySummary),
});

export type CacheLocation = { dir: string; file: string };

export const startupListLocation = (
  token: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): CacheLocation => {
  const cacheHome = env["XDG_CACHE_HOME"];
  const base = cacheHome !== undefined && isAbsolute(cacheHome) ? cacheHome : join(home, ".cache");
  const dir = join(base, "shortcut-tui");
  const key = createHash("sha256").update(token).digest("hex").slice(0, 16);
  return { dir, file: join(dir, `story-list-${key}.json`) };
};

export const readStartupList = async (file: string, now: Date): Promise<StartupList | null> => {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
  const parsed = StartupListFile.safeParse(raw);
  if (!parsed.success) return null;
  const { mentionName, savedAt, stories } = parsed.data;
  if (now.getTime() - savedAt.getTime() > MAX_CACHE_AGE_MS) return null;
  return { mentionName, savedAt, stories };
};

export const writeStartupList = async (
  { dir, file }: CacheLocation,
  list: StartupList,
): Promise<void> => {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ version: VERSION, ...list }), {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
};

export const openStartupCache = async (
  location: CacheLocation,
  now: Date,
): Promise<StartupCache> => {
  let writing = Promise.resolve();
  return {
    list: await readStartupList(location.file, now),
    save: (list) => {
      writing = writing.then(() => writeStartupList(location, list)).catch(() => undefined);
      return writing;
    },
  };
};
