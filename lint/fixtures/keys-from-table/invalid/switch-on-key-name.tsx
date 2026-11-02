import { useKeyboard } from "@opentui/react";

export const Bad = ({ quit }: { quit: () => void }) => {
  useKeyboard((key) => {
    switch (key.name) {
      case "q":
        return quit();
    }
  });
  return null;
};
