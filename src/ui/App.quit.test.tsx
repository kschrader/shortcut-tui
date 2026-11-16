import { afterEach, expect, test } from "bun:test";
import type { StoryMove } from "../app/model.ts";
import { update } from "../app/update.ts";
import {
  browsing,
  cleanup,
  inProgress,
  launchDemo,
  ready,
  requestId,
  show,
  stories,
} from "./frame.tsx";

afterEach(cleanup);

const confirming = browsing({ focus: { mode: "confirmingQuit" } });

const saving: StoryMove = {
  status: "saving",
  requestId: requestId(11),
  target: inProgress,
  pending: null,
  known: ready,
  trustFrom: requestId(1),
};

const bottomLine = (frame: string) => frame.trimEnd().split("\n").at(-1) ?? "";

test("q asks before quitting instead of quitting", async () => {
  const { screen, dispatched, calls } = await show(browsing());
  screen.mockInput.pressKey("q");
  expect(dispatched).toEqual([{ type: "quitRequested" }]);
  expect(calls.quit).toBe(0);
});

test("the dialog asks whether to quit and the bar names the answers, at 80x24", async () => {
  const { frame } = await show(confirming, { width: 80, height: 24 });
  const text = frame();
  expect(text).toContain("Quit");
  expect(text).toContain("Are you sure you want to quit?");
  expect(text).not.toContain("still saving");
  expect(bottomLine(text)).toContain("y quit  n stay");
});

test("y, q and enter quit from the dialog", async () => {
  const { screen, dispatched, calls } = await show(confirming);
  screen.mockInput.pressKey("y");
  screen.mockInput.pressKey("q");
  screen.mockInput.pressEnter();
  await Bun.sleep(50);
  expect(calls.quit).toBe(3);
  expect(dispatched).toEqual([]);
});

test("n and esc stay, and other keys do nothing while the dialog is open", async () => {
  const { screen, dispatched, calls } = await show(confirming);
  for (const key of ["j", "/", "r", "m", "?"]) screen.mockInput.pressKey(key);
  screen.mockInput.pressKey("n");
  screen.mockInput.pressEscape();
  await Bun.sleep(50);
  expect(dispatched).toEqual([{ type: "quitCancelled" }, { type: "quitCancelled" }]);
  expect(calls.quit).toBe(0);
});

test("the dialog warns when moves are still saving", async () => {
  const one = await show(
    browsing({ focus: { mode: "confirmingQuit" }, moves: new Map([[stories[1].id, saving]]) }),
  );
  expect(one.frame()).toContain("A move is still saving and may not reach Shortcut.");
  cleanup();
  const two = await show(
    browsing({
      focus: { mode: "confirmingQuit" },
      moves: new Map([
        [stories[0].id, saving],
        [stories[1].id, saving],
      ]),
    }),
  );
  expect(two.frame()).toContain("2 moves are still saving and may not reach Shortcut.");
});

test("quitting is asked only from the list, and staying returns to it", () => {
  const [asked] = update(browsing(), { type: "quitRequested" });
  expect(asked.focus).toEqual({ mode: "confirmingQuit" });
  const [stayed] = update(asked, { type: "quitCancelled" });
  expect(stayed.focus).toEqual({ mode: "browsing" });
  const helping = browsing({ focus: { mode: "help" } });
  expect(update(helping, { type: "quitRequested" })[0]).toBe(helping);
  expect(update(browsing(), { type: "quitCancelled" })[0].focus).toEqual({ mode: "browsing" });
});

test("in the demo, q then n stays, and q then y quits once", async () => {
  const { frame, press, until, calls } = await launchDemo();
  await press("q");
  await until(() => frame().includes("Are you sure you want to quit?"));
  await press("n");
  await until(() => !frame().includes("Are you sure you want to quit?"));
  expect(calls.quit).toBe(0);
  await press("j");
  await press("q");
  await until(() => frame().includes("Are you sure you want to quit?"));
  await press("y");
  expect(calls.quit).toBe(1);
});
