import { afterEach, expect, test } from "bun:test";
import { ageFloorFrom, defaultQueryFor, queryView } from "../app/filters.ts";
import type { Question, View } from "../app/model.ts";
import { browsing, cleanup, loaded, show, stories } from "./frame.tsx";

afterEach(cleanup);

const now = new Date("2026-11-02T12:00:00Z");

const floored = (view: View): Question => ({ view, movedOnOrBefore: ageFloorFrom(now) });

const showing = (question: Question) =>
  show(browsing({ question, results: loaded({ question, stories }) }), { width: 80, now });

const header = (frame: string) => frame.split("\n")[0] ?? "";

test("the header marks a floored view at 80 columns and keeps the story count", async () => {
  const { frame } = await showing(floored(defaultQueryFor("ada")));
  expect(header(frame())).toMatch(/my started stories {2}· 4w\+\s+3 stories $/);
});

test("a long typed query gives way to the floor mark and the count", async () => {
  const typed = "owner:ada is:started !is:archived label:backend label:urgent epic:payments";
  const { frame } = await showing(floored(queryView(typed)));
  expect(header(frame())).toMatch(/owner:ada is:started.* {2}· 4w\+\s+3 stories $/);
});

test("the header has no floor mark while the floor is off", async () => {
  const { frame } = await showing({ view: defaultQueryFor("ada"), movedOnOrBefore: null });
  expect(header(frame())).not.toContain("4w+");
});

test("a toggles the floor at the time it is pressed", async () => {
  const { screen, dispatched } = await show(browsing(), { width: 80, now });
  screen.mockInput.pressKey("a");
  expect(dispatched).toEqual([{ type: "ageFloorToggled", at: now }]);
});

test("help lists a", async () => {
  const { frame } = await show(browsing({ focus: { mode: "help" } }), { width: 80, height: 24 });
  expect(frame().replace(/ +/g, " ")).toContain("a Only 4+ weeks in state");
});
