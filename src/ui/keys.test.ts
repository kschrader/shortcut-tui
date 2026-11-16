import { expect, test } from "bun:test";
import type { Focus } from "../app/model.ts";
import { appliesTo, bindingFor, keyBindings } from "./keys.ts";

const modes: readonly Focus["mode"][] = [
  "browsing",
  "editingQuery",
  "help",
  "picking",
  "readOnly",
  "confirmingQuit",
];

test("ctrl-c quits from every focus mode", () => {
  for (const mode of modes) {
    expect(bindingFor(mode, { name: "c", ctrl: true })?.action).toEqual({ type: "quit" });
  }
});

test("within one mode no two bindings share a label or a keystroke, so help rows are unambiguous", () => {
  for (const mode of modes) {
    const bindings = keyBindings.filter((binding) => appliesTo(binding, mode));
    const labels = bindings.map((binding) => binding.label);
    expect(new Set(labels).size).toBe(labels.length);
    const strokes = bindings.flatMap((binding) =>
      binding.keys.map((stroke) => `${stroke.ctrl === true ? "ctrl-" : ""}${stroke.name}`),
    );
    expect(new Set(strokes).size).toBe(strokes.length);
  }
});

test("every mode other than browsing has an escape binding that leads out of it", () => {
  for (const mode of modes.filter((candidate) => candidate !== "browsing")) {
    expect(bindingFor(mode, { name: "escape", ctrl: false })?.action.type).toBe("dispatch");
  }
});
