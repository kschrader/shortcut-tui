import { useState } from "react";
import { colors } from "./theme.ts";

const LIST_WIDTH_RATIO = 0.55;
const MIN_LIST_WIDTH = 52;
const MIN_DRAGGED_LIST_WIDTH = 30;
const MIN_DETAIL_WIDTH = 30;
const SPLITTER_WIDTH = 1;

export const listWidthFor = (terminalWidth: number, dragged: number | null): number => {
  if (dragged === null) {
    return Math.min(
      terminalWidth,
      Math.max(MIN_LIST_WIDTH, Math.floor(terminalWidth * LIST_WIDTH_RATIO)),
    );
  }
  const widest = terminalWidth - MIN_DETAIL_WIDTH - SPLITTER_WIDTH;
  return Math.min(terminalWidth, Math.max(MIN_DRAGGED_LIST_WIDTH, Math.min(dragged, widest)));
};

export const Splitter = ({ onDrag }: { onDrag: (column: number) => void }) => {
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  return (
    <box
      width={SPLITTER_WIDTH}
      border={["left"]}
      borderColor={hovered || dragging ? colors.accent : colors.dim}
      backgroundColor={colors.panel}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseDown={() => setDragging(true)}
      onMouseDrag={(event) => onDrag(event.x)}
      onMouseDragEnd={() => setDragging(false)}
      onMouseUp={() => setDragging(false)}
    />
  );
};
