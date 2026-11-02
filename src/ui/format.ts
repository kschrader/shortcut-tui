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

export const ownerNames = (owners: readonly MemberRef[]): string =>
  owners.length === 0 ? "Unassigned" : owners.map((owner) => owner.name).join(", ");

export const epicName = (epic: StorySummary["epic"]): string => epic?.name ?? "None";

export const estimateLabel = (estimate: number | null): string =>
  estimate === null ? "–" : String(estimate);

export const dateLabel = (date: Date): string => date.toISOString().slice(0, 10);

export const storyCount = (count: number): string =>
  `${count} ${count === 1 ? "story" : "stories"}`;
