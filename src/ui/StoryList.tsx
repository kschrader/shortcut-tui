import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { Grouping } from "../app/filters.ts";
import type { Cached, Change, StoryMove, StoryPullRequests } from "../app/model.ts";
import { ownerGroupLabel } from "../app/order.ts";
import type { StoryId, StorySummary } from "../shortcut/types.ts";
import {
  estimateLabel,
  fit,
  nameCell,
  typeStyle,
  WAITED_WIDTH,
  waitedLabel,
  type NameMark,
} from "./format.ts";
import { badgeStyle, BADGE_LABEL_WIDTH, storyBadge, type Badge } from "./pull-requests.ts";
import { awaitsYourReview, YOUR_REVIEW_MARK } from "./reviews.ts";
import { colors } from "./theme.ts";

const ROW_CHROME_WIDTH = 8;
const LEFT_BUTTON = 0;
const MIN_NAME_WIDTH_BESIDE_LABELS = 32;
const AGE_COLUMN_WIDTH = 1 + WAITED_WIDTH;

type BadgeColumn = "none" | "glyph" | "labelled";

const badgeColumnWidth: Record<BadgeColumn, number> = {
  none: 0,
  glyph: 2,
  labelled: 3 + BADGE_LABEL_WIDTH,
};

type MoveMark = { text: string; color: string };

export const moveMark = (move: StoryMove | undefined): MoveMark | null => {
  switch (move?.status) {
    case "saving":
      return { text: "⟳ saving", color: colors.accent };
    case "failed":
      return { text: "✗ failed", color: colors.error };
    case "moved":
    case undefined:
      return null;
  }
};

const MOVE_MARK_WIDTH = 1 + Math.max(...["⟳ saving", "✗ failed"].map((text) => text.length));

type Props = {
  stories: readonly StorySummary[];
  selectedId: StoryId | null;
  pullRequests: Cached<StoryPullRequests>;
  moves: ReadonlyMap<StoryId, StoryMove>;
  unseen: ReadonlyMap<StoryId, readonly Change[]>;
  grouping: Grouping;
  reviewing: boolean;
  now: Date;
  width: number;
  onSelect: (id: StoryId) => void;
};

type Group = { key: string; first: StorySummary; stories: StorySummary[] };

const groupKey = (grouping: Grouping, story: StorySummary): string => {
  switch (grouping) {
    case "state":
      return String(story.state.id);
    case "owner":
      return ownerGroupLabel(story);
  }
};

const groupBy = (grouping: Grouping, stories: readonly StorySummary[]): Group[] => {
  const groups: Group[] = [];
  for (const story of stories) {
    const key = groupKey(grouping, story);
    const current = groups.at(-1);
    if (current?.key === key) current.stories.push(story);
    else groups.push({ key, first: story, stories: [story] });
  }
  return groups;
};

const DIVIDER_CHROME_WIDTH = "── ".length + "  ".length + " ─".length + 1;

const dividerLabel = (grouping: Grouping, group: Group, width: number): string => {
  const count = String(group.stories.length);
  switch (grouping) {
    case "state":
      return `── ${group.first.state.name}  ${count}  · ${group.first.state.workflow.name} `;
    case "owner": {
      const owners = fit(group.key, width - count.length - DIVIDER_CHROME_WIDTH).trimEnd();
      return `── ${owners}  ${count} `;
    }
  }
};

const Divider = ({ label, width }: { label: string; width: number }) => (
  <box height={1}>
    <text wrapMode="none" fg={colors.dim}>
      {label.padEnd(width - 1, "─").slice(0, width - 1)}
    </text>
  </box>
);

const badgeText = (badge: Badge | null, column: BadgeColumn): string => {
  const style = badge === null ? null : badgeStyle[badge];
  switch (column) {
    case "none":
      return "";
    case "glyph":
      return ` ${style?.glyph ?? " "}`;
    case "labelled":
      return ` ${style?.glyph ?? " "} ${(style?.label ?? "").padEnd(BADGE_LABEL_WIDTH)}`;
  }
};

const gutter = (selected: boolean, changed: boolean): string => {
  if (selected) return "▌";
  return changed ? "•" : " ";
};

const nameMarkColor: Record<NameMark["kind"], string> = {
  blocked: colors.error,
  blocker: colors.caution,
  family: colors.dim,
};

const reviewMarkWidth = (yours: boolean | null) => (yours === null ? 0 : YOUR_REVIEW_MARK.length);

const StoryRow = ({
  story,
  selected,
  changed,
  badge,
  badgeColumn,
  mark,
  markColumnWidth,
  yours,
  waited,
  width,
  onSelect,
}: {
  story: StorySummary;
  selected: boolean;
  changed: boolean;
  badge: Badge | null;
  badgeColumn: BadgeColumn;
  mark: MoveMark | null;
  markColumnWidth: number;
  yours: boolean | null;
  waited: string;
  width: number;
  onSelect: (id: StoryId) => void;
}) => {
  const { glyph, color } = typeStyle[story.storyType];
  const idLabel = String(story.id).padStart(6);
  const nameWidth =
    width -
    idLabel.length -
    ROW_CHROME_WIDTH -
    badgeColumnWidth[badgeColumn] -
    markColumnWidth -
    reviewMarkWidth(yours) -
    AGE_COLUMN_WIDTH;
  const cell = nameCell(story, nameWidth);
  return (
    <box
      id={`story-${story.id}`}
      height={1}
      backgroundColor={selected ? colors.selection : colors.background}
      onMouseDown={(event) => {
        if (event.button === LEFT_BUTTON) onSelect(story.id);
      }}
    >
      <text wrapMode="none" fg={selected ? colors.textBright : colors.text}>
        <span fg={colors.accent}>{gutter(selected, changed)}</span>
        {yours === null ? null : <span fg={colors.accent}>{yours ? YOUR_REVIEW_MARK : " "}</span>}
        <span fg={color}>{glyph}</span>
        <span fg={colors.dim}>{` ${idLabel} `}</span>
        {cell.marks.map((nameMark) => (
          <span key={nameMark.kind} fg={nameMarkColor[nameMark.kind]}>
            {nameMark.text}
          </span>
        ))}
        {selected ? <b>{cell.name}</b> : cell.name}
        <span fg={colors.dim}>{` ${waited.padStart(WAITED_WIDTH)}`}</span>
        <span fg={mark?.color ?? colors.dim}>
          {mark === null ? "".padEnd(markColumnWidth) : ` ${mark.text}`.padEnd(markColumnWidth)}
        </span>
        <span fg={badge === null ? colors.dim : badgeStyle[badge].color}>
          {badgeText(badge, badgeColumn)}
        </span>
        <span fg={colors.dim}> </span>
        <span fg={colors.dim}>{estimateLabel(story.estimate).padStart(2)}</span>
      </text>
    </box>
  );
};

const badgeColumnFor = (
  stories: readonly StorySummary[],
  width: number,
  otherColumnsWidth: number,
): BadgeColumn => {
  if (!stories.some((story) => story.pullRequestCount > 0)) return "none";
  const widestId = Math.max(6, ...stories.map((story) => String(story.id).length));
  const nameWidth =
    width - widestId - ROW_CHROME_WIDTH - badgeColumnWidth.labelled - otherColumnsWidth;
  return nameWidth >= MIN_NAME_WIDTH_BESIDE_LABELS ? "labelled" : "glyph";
};

export const StoryList = ({
  stories,
  selectedId,
  pullRequests,
  moves,
  unseen,
  grouping,
  reviewing,
  now,
  width,
  onSelect,
}: Props) => {
  const scroll = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    if (selectedId !== null) scroll.current?.scrollChildIntoView(`story-${selectedId}`);
  }, [selectedId]);

  const markColumnWidth = stories.some((story) => moveMark(moves.get(story.id)) !== null)
    ? MOVE_MARK_WIDTH
    : 0;
  const badgeColumn = badgeColumnFor(
    stories,
    width,
    markColumnWidth + AGE_COLUMN_WIDTH + (reviewing ? YOUR_REVIEW_MARK.length : 0),
  );
  return (
    <scrollbox ref={scroll} flexGrow={1} scrollY>
      {groupBy(grouping, stories).flatMap((group, index) => [
        <Divider
          key={`divider-${String(index)}`}
          label={dividerLabel(grouping, group, width)}
          width={width}
        />,
        ...group.stories.map((story) => (
          <StoryRow
            key={story.id}
            story={story}
            selected={story.id === selectedId}
            changed={unseen.has(story.id)}
            badge={storyBadge(story, pullRequests)}
            badgeColumn={badgeColumn}
            mark={moveMark(moves.get(story.id))}
            markColumnWidth={markColumnWidth}
            yours={reviewing ? awaitsYourReview(story, pullRequests) : null}
            waited={waitedLabel(story.movedAt, now)}
            width={width}
            onSelect={onSelect}
          />
        )),
      ])}
    </scrollbox>
  );
};
