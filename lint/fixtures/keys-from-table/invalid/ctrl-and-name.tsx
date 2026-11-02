import { useKeyboard } from "@opentui/react";

export const Bad = ({ quit }: { quit: () => void }) => {
  useKeyboard(function onKey(event) {
    if (event.ctrl && event.name === "c") quit();
  });
  return null;
};
