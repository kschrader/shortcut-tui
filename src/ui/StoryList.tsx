import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { Remote, StoryMove, StoryPullRequests } from "../app/model.ts";
import type { StoryId, StorySummary } from "../shortcut/types.ts";
import { estimateLabel, fit, typeStyle } from "./format.ts";
import { badgeStyle, BADGE_LABEL_WIDTH, storyBadge, type Badge } from "./pull-requests.ts";
import { colors } from "./theme.ts";

const ROW_CHROME_WIDTH = 8;
const MIN_NAME_WIDTH_BESIDE_LABELS = 36;

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
  pullRequests: Remote<StoryPullRequests>;
  moves: ReadonlyMap<StoryId, StoryMove>;
  width: number;
};

type StateGroup = { state: StorySummary["state"]; stories: StorySummary[] };

const groupByState = (stories: readonly StorySummary[]): StateGroup[] => {
  const groups: StateGroup[] = [];
  for (const story of stories) {
    const current = groups.at(-1);
    if (current?.state.id === story.state.id) current.stories.push(story);
    else groups.push({ state: story.state, stories: [story] });
  }
  return groups;
};

const Divider = ({ group, width }: { group: StateGroup; width: number }) => {
  const label = `── ${group.state.name}  ${String(group.stories.length)}  · ${group.state.workflow.name} `;
  return (
    <box height={1}>
      <text wrapMode="none" fg={colors.dim}>
        {label.padEnd(width - 1, "─").slice(0, width - 1)}
      </text>
    </box>
  );
};

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

const StoryRow = ({
  story,
  selected,
  badge,
  badgeColumn,
  mark,
  markColumnWidth,
  width,
}: {
  story: StorySummary;
  selected: boolean;
  badge: Badge | null;
  badgeColumn: BadgeColumn;
  mark: MoveMark | null;
  markColumnWidth: number;
  width: number;
}) => {
  const { glyph, color } = typeStyle[story.storyType];
  const idLabel = String(story.id).padStart(6);
  const nameWidth =
    width - idLabel.length - ROW_CHROME_WIDTH - badgeColumnWidth[badgeColumn] - markColumnWidth;
  return (
    <box
      id={`story-${story.id}`}
      height={1}
      backgroundColor={selected ? colors.selection : colors.background}
    >
      <text wrapMode="none" fg={selected ? colors.textBright : colors.text}>
        <span fg={selected ? colors.accent : colors.background}>{selected ? "▌" : " "}</span>
        <span fg={color}>{glyph}</span>
        <span fg={colors.dim}>{` ${idLabel} `}</span>
        {selected ? <b>{fit(story.name, nameWidth)}</b> : fit(story.name, nameWidth)}
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
  markColumnWidth: number,
): BadgeColumn => {
  if (!stories.some((story) => story.pullRequestCount > 0)) return "none";
  const widestId = Math.max(6, ...stories.map((story) => String(story.id).length));
  const nameWidth =
    width - widestId - ROW_CHROME_WIDTH - badgeColumnWidth.labelled - markColumnWidth;
  return nameWidth >= MIN_NAME_WIDTH_BESIDE_LABELS ? "labelled" : "glyph";
};

export const StoryList = ({ stories, selectedId, pullRequests, moves, width }: Props) => {
  const scroll = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    if (selectedId !== null) scroll.current?.scrollChildIntoView(`story-${selectedId}`);
  }, [selectedId]);

  const markColumnWidth = stories.some((story) => moveMark(moves.get(story.id)) !== null)
    ? MOVE_MARK_WIDTH
    : 0;
  const badgeColumn = badgeColumnFor(stories, width, markColumnWidth);
  return (
    <scrollbox ref={scroll} flexGrow={1} scrollY>
      {groupByState(stories).flatMap((group, index) => [
        <Divider key={`divider-${String(index)}`} group={group} width={width} />,
        ...group.stories.map((story) => (
          <StoryRow
            key={story.id}
            story={story}
            selected={story.id === selectedId}
            badge={storyBadge(story, pullRequests)}
            badgeColumn={badgeColumn}
            mark={moveMark(moves.get(story.id))}
            markColumnWidth={markColumnWidth}
            width={width}
          />
        )),
      ])}
    </scrollbox>
  );
};
