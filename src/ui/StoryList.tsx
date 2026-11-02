import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { StoryId, StorySummary } from "../shortcut/types.ts";
import { estimateLabel, fit, typeStyle } from "./format.ts";
import { colors } from "./theme.ts";

const STATE_WIDTH = 13;
const ROW_CHROME_WIDTH = 8;
const NARROWEST_NAME_BESIDE_STATE = 32;

const rowLayout = (listWidth: number, idWidth: number) => {
  const nameBesideState = listWidth - idWidth - ROW_CHROME_WIDTH - STATE_WIDTH - 2;
  return nameBesideState >= NARROWEST_NAME_BESIDE_STATE
    ? { nameWidth: nameBesideState, showState: true }
    : { nameWidth: listWidth - idWidth - ROW_CHROME_WIDTH, showState: false };
};

type Props = {
  stories: readonly StorySummary[];
  selectedId: StoryId | null;
  width: number;
};

export const StoryList = ({ stories, selectedId, width }: Props) => {
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
        const { nameWidth, showState } = rowLayout(width, idLabel.length);
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
                {showState ? ` ${fit(story.state.name, STATE_WIDTH)} ` : " "}
              </span>
              <span fg={colors.dim}>{estimateLabel(story.estimate).padStart(2)}</span>
            </text>
          </box>
        );
      })}
    </scrollbox>
  );
};
