import type { MemberRef, StorySummary, StoryType } from "../shortcut/types.ts";

export const fit = (text: string, width: number): string => {
  if (width <= 0) return "";
  const flat = text.replace(/\s+/g, " ");
  return flat.length <= width ? flat.padEnd(width) : `${flat.slice(0, width - 1)}…`;
};

export const typeStyle: Record<StoryType, { glyph: string; color: string }> = {
  feature: { glyph: "●", color: "#e5c07b" },
  bug: { glyph: "◆", color: "#e06c75" },
  chore: { glyph: "■", color: "#7aa2f7" },
};

export const SUB_TASK_MARK = "↳";
export const PARENT_MARK = "▸";

const familyMark = ({ parent, subTaskCount }: StorySummary): string => {
  const asChild = parent === null ? "" : `${SUB_TASK_MARK} `;
  const asParent = subTaskCount > 0 ? `${PARENT_MARK}${String(subTaskCount)} ` : "";
  return `${asChild}${asParent}`;
};

export const nameCell = (story: StorySummary, width: number): { mark: string; name: string } => {
  const mark = familyMark(story);
  const cell = fit(`${mark}${story.name}`, width);
  return { mark: cell.slice(0, mark.length), name: cell.slice(mark.length) };
};

export const ownerNames = (owners: readonly MemberRef[]): string =>
  owners.length === 0 ? "Unassigned" : owners.map((owner) => owner.name).join(", ");

export const epicName = (epic: StorySummary["epic"]): string => epic?.name ?? "None";

export const estimateLabel = (estimate: number | null): string =>
  estimate === null ? "–" : String(estimate);

export const dateLabel = (date: Date): string => date.toISOString().slice(0, 10);

export const storyCount = (count: number): string =>
  `${count} ${count === 1 ? "story" : "stories"}`;

const MINUTE_MS = 60_000;

export const ageLabel = (since: Date, now: Date): string => {
  const minutes = Math.floor(Math.max(0, now.getTime() - since.getTime()) / MINUTE_MS);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  return `${String(Math.floor(hours / 24))}d ago`;
};

const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

type Waited = { count: number; unit: "hour" | "day" | "week" | "year" } | null;

const waited = (since: Date, now: Date): Waited => {
  const ms = Math.max(0, now.getTime() - since.getTime());
  if (ms < HOUR_MS) return null;
  if (ms < DAY_MS) return { count: Math.floor(ms / HOUR_MS), unit: "hour" };
  if (ms < 2 * WEEK_MS) return { count: Math.floor(ms / DAY_MS), unit: "day" };
  if (ms < 100 * WEEK_MS) return { count: Math.floor(ms / WEEK_MS), unit: "week" };
  return { count: Math.floor(ms / YEAR_MS), unit: "year" };
};

export const WAITED_WIDTH = 3;

export const waitedLabel = (since: Date, now: Date): string => {
  const time = waited(since, now);
  return time === null ? "<1h" : `${String(time.count)}${time.unit[0] ?? ""}`;
};

export const waitedPhrase = (since: Date, now: Date): string => {
  const time = waited(since, now);
  if (time === null) return "less than an hour";
  return `${String(time.count)} ${time.unit}${time.count === 1 ? "" : "s"}`;
};
