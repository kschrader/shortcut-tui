import { useKeyboard } from "@opentui/react";

declare const bindingFor: (key: { name: string; ctrl: boolean }) => (() => void) | undefined;

export const Good = () => {
  useKeyboard((key) => {
    bindingFor(key)?.();
  });
  return null;
};
