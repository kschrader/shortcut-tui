import type { ScrollBoxRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";
import type { StorySummary, WorkflowState } from "../shortcut/types.ts";
import { colors } from "./theme.ts";

type Props = {
  story: StorySummary;
  states: readonly WorkflowState[];
  cursor: number;
  height: number;
};

const CHROME_ROWS = 6;
const CURRENT_LABEL = "current";

export const MovePicker = ({ story, states, cursor, height }: Props) => {
  const scroll = useRef<ScrollBoxRenderable>(null);
  const highlighted = states[cursor];
  useEffect(() => {
    if (highlighted !== undefined) scroll.current?.scrollChildIntoView(`state-${highlighted.id}`);
  }, [highlighted]);

  const nameWidth = Math.max(...states.map((state) => state.name.length));
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        borderStyle="rounded"
        borderColor={colors.accent}
        backgroundColor={colors.panel}
        title={` Move ${String(story.id)} `}
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
      >
        <text fg={colors.dim}>{` ${story.state.workflow.name} workflow`}</text>
        <scrollbox ref={scroll} scrollY maxHeight={Math.max(1, height - CHROME_ROWS)}>
          {states.map((state, index) => {
            const current = state.id === story.state.id;
            const selected = index === cursor;
            return (
              <box
                key={state.id}
                id={`state-${state.id}`}
                height={1}
                backgroundColor={selected ? colors.selection : colors.panel}
              >
                <text wrapMode="none" fg={selected ? colors.textBright : colors.text}>
                  <span fg={selected ? colors.accent : colors.panel}>{selected ? "▌" : " "}</span>
                  <span fg={colors.ok}>{current ? "● " : "  "}</span>
                  {selected ? <b>{state.name.padEnd(nameWidth)}</b> : state.name.padEnd(nameWidth)}
                  <span fg={colors.dim}>
                    {`  ${current ? CURRENT_LABEL : "".padEnd(CURRENT_LABEL.length)}`}
                  </span>
                </text>
              </box>
            );
          })}
        </scrollbox>
      </box>
    </box>
  );
};
