import type { Focus, Msg } from "../app/model.ts";

export type KeyAction =
  | { type: "quit" }
  | { type: "dispatch"; msg: Msg }
  | { type: "scrollDetail"; viewports: number }
  | { type: "openStory" }
  | { type: "openPullRequest" };

type Keystroke = { name: string; ctrl?: true };

type KeyBinding = {
  modes: readonly Focus["mode"][];
  keys: readonly Keystroke[];
  label: string;
  description: string;
  hint?: string;
  action: KeyAction;
};

const dispatch = (msg: Msg): KeyAction => ({ type: "dispatch", msg });

export const keyBindings: readonly KeyBinding[] = [
  {
    modes: ["browsing"],
    keys: [{ name: "j" }, { name: "down" }],
    label: "j / ↓",
    description: "Next story",
    hint: "j/k move",
    action: dispatch({ type: "selectionMoved", delta: 1 }),
  },
  {
    modes: ["browsing"],
    keys: [{ name: "k" }, { name: "up" }],
    label: "k / ↑",
    description: "Previous story",
    action: dispatch({ type: "selectionMoved", delta: -1 }),
  },
  {
    modes: ["browsing"],
    keys: [{ name: "/" }],
    label: "/",
    description: "Edit the search query",
    hint: "/ query",
    action: dispatch({ type: "queryEditStarted" }),
  },
  {
    modes: ["editingQuery"],
    keys: [{ name: "escape" }],
    label: "esc",
    description: "Cancel the query edit",
    action: dispatch({ type: "queryEditCancelled" }),
  },
  {
    modes: ["browsing"],
    keys: [{ name: "r" }],
    label: "r",
    description: "Refresh stories and PRs",
    hint: "r refresh",
    action: dispatch({ type: "refreshRequested" }),
  },
  {
    modes: ["browsing"],
    keys: [{ name: "o" }],
    label: "o",
    description: "Open story in browser",
    hint: "o open",
    action: { type: "openStory" },
  },
  {
    modes: ["browsing"],
    keys: [{ name: "p" }],
    label: "p",
    description: "Open its pull request",
    hint: "p PR",
    action: { type: "openPullRequest" },
  },
  {
    modes: ["browsing"],
    keys: [{ name: "m" }],
    label: "m",
    description: "Move to another state",
    hint: "m move",
    action: dispatch({ type: "movePickerOpened" }),
  },
  {
    modes: ["picking"],
    keys: [{ name: "j" }, { name: "down" }],
    label: "j / ↓",
    description: "Next state",
    hint: "j/k choose",
    action: dispatch({ type: "movePickerMoved", delta: 1 }),
  },
  {
    modes: ["picking"],
    keys: [{ name: "k" }, { name: "up" }],
    label: "k / ↑",
    description: "Previous state",
    action: dispatch({ type: "movePickerMoved", delta: -1 }),
  },
  {
    modes: ["picking"],
    keys: [{ name: "return" }],
    label: "enter",
    description: "Move the story there",
    hint: "enter move",
    action: dispatch({ type: "movePickerConfirmed" }),
  },
  {
    modes: ["picking"],
    keys: [{ name: "escape" }],
    label: "esc",
    description: "Cancel the move",
    hint: "esc cancel",
    action: dispatch({ type: "movePickerClosed" }),
  },
  {
    modes: ["readOnly"],
    keys: [{ name: "escape" }],
    label: "esc",
    description: "Close the read-only notice",
    hint: "esc close",
    action: dispatch({ type: "readOnlyNoticeClosed" }),
  },
  {
    modes: ["browsing"],
    keys: [{ name: "pagedown" }],
    label: "pgdn",
    description: "Scroll details down",
    action: { type: "scrollDetail", viewports: 0.5 },
  },
  {
    modes: ["browsing"],
    keys: [{ name: "pageup" }],
    label: "pgup",
    description: "Scroll details up",
    action: { type: "scrollDetail", viewports: -0.5 },
  },
  {
    modes: ["browsing"],
    keys: [{ name: "?" }],
    label: "?",
    description: "Show this help",
    hint: "? help",
    action: dispatch({ type: "helpOpened" }),
  },
  {
    modes: ["help"],
    keys: [{ name: "?" }, { name: "escape" }],
    label: "? / esc",
    description: "Close this help",
    hint: "? or esc close help",
    action: dispatch({ type: "helpClosed" }),
  },
  {
    modes: ["browsing"],
    keys: [{ name: "q" }],
    label: "q",
    description: "Quit",
    hint: "q quit",
    action: { type: "quit" },
  },
  {
    modes: ["browsing", "editingQuery", "help", "picking", "readOnly"],
    keys: [{ name: "c", ctrl: true }],
    label: "ctrl-c",
    description: "Quit from anywhere",
    action: { type: "quit" },
  },
];

export const bindingFor = (
  mode: Focus["mode"],
  key: { name: string; ctrl: boolean },
): KeyBinding | undefined =>
  keyBindings.find(
    (binding) =>
      binding.modes.includes(mode) &&
      binding.keys.some(
        (stroke) => stroke.name === key.name && (stroke.ctrl ?? false) === key.ctrl,
      ),
  );

export const hintFor = (mode: Focus["mode"]): string =>
  keyBindings
    .filter((binding) => binding.modes.includes(mode))
    .flatMap((binding) => (binding.hint === undefined ? [] : [binding.hint]))
    .join("  ·  ");
