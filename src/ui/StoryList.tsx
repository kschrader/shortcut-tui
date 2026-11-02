import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { StoryId, StorySummary } from "../shortcut/types.ts";
import { estimateLabel, fit, typeStyle } from "./format.ts";
import { colors } from "./theme.ts";

const ROW_CHROME_WIDTH = 8;

type Props = {
  stories: readonly StorySummary[];
  selectedId: StoryId | null;
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
  const label = `── ${group.state.name}  ${String(group.stories.length)}  · ${group.state.workflowName} `;
  return (
    <box height={1}>
      <text wrapMode="none" fg={colors.dim}>
        {label.padEnd(width - 1, "─").slice(0, width - 1)}
      </text>
    </box>
  );
};

const StoryRow = ({
  story,
  selected,
  width,
}: {
  story: StorySummary;
  selected: boolean;
  width: number;
}) => {
  const { glyph, color } = typeStyle[story.storyType];
  const idLabel = String(story.id).padStart(6);
  const nameWidth = width - idLabel.length - ROW_CHROME_WIDTH;
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
        <span fg={colors.dim}> </span>
        <span fg={colors.dim}>{estimateLabel(story.estimate).padStart(2)}</span>
      </text>
    </box>
  );
};

export const StoryList = ({ stories, selectedId, width }: Props) => {
  const scroll = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    if (selectedId !== null) scroll.current?.scrollChildIntoView(`story-${selectedId}`);
  }, [selectedId]);

  return (
    <scrollbox ref={scroll} flexGrow={1} scrollY>
      {groupByState(stories).flatMap((group, index) => [
        <Divider key={`divider-${String(index)}`} group={group} width={width} />,
        ...group.stories.map((story) => (
          <StoryRow key={story.id} story={story} selected={story.id === selectedId} width={width} />
        )),
      ])}
    </scrollbox>
  );
};
