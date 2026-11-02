import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { StoryId, StorySummary, Workspace } from "../shortcut/types.ts";
import { estimateLabel, fit, stateName, typeStyle } from "./format.ts";
import { colors } from "./theme.ts";

const STATE_WIDTH = 13;

type Props = {
  stories: readonly StorySummary[];
  selectedId: StoryId | null;
  workspace: Workspace | null;
  width: number;
};

export const StoryList = ({ stories, selectedId, workspace, width }: Props) => {
  const scroll = useRef<ScrollBoxRenderable>(null);
  useEffect(() => {
    if (selectedId !== null) scroll.current?.scrollChildIntoView(`story-${selectedId}`);
  }, [selectedId]);

  return (
    <scrollbox ref={scroll} flexGrow={1} scrollY>
      {stories.map((story) => {
        const selected = story.id === selectedId;
        const { glyph, color } = typeStyle[story.storyType];
        const idLabel = String(story.id).padStart(6);
        const nameWidth = width - 2 - 1 - idLabel.length - 1 - 1 - STATE_WIDTH - 1 - 2 - 1;
        return (
          <box
            key={story.id}
            id={`story-${story.id}`}
            height={1}
            backgroundColor={selected ? colors.selection : colors.background}
          >
            <text wrapMode="none" fg={selected ? colors.textBright : colors.text}>
              <span fg={selected ? colors.accent : colors.background}>{selected ? "▌" : " "}</span>
              <span fg={color}>{glyph}</span>
              <span fg={colors.dim}>{` ${idLabel} `}</span>
              {selected ? <b>{fit(story.name, nameWidth)}</b> : fit(story.name, nameWidth)}
              <span fg={colors.dim}>
                {` ${fit(stateName(workspace, story.workflowStateId), STATE_WIDTH)} `}
              </span>
              <span fg={colors.dim}>{estimateLabel(story.estimate).padStart(2)}</span>
            </text>
          </box>
        );
      })}
    </scrollbox>
  );
};
