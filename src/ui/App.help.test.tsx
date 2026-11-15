import { afterEach, expect, test } from "bun:test";
import { badgeStyle } from "./pull-requests.ts";
import { browsing, cleanup, show } from "./frame.tsx";
import { bindingsUsableIn, keyBindings } from "./keys.ts";

afterEach(cleanup);

const helping = () => browsing({ focus: { mode: "help" } });

test("the overlay lists every key usable while browsing and every badge at 80x24", async () => {
  const { frame } = await show(helping(), { width: 80, height: 24 });
  const text = frame().replace(/ +/g, " ");
  expect(text).toContain("Help");
  for (const binding of bindingsUsableIn("browsing")) {
    expect(text).toContain(`${binding.label} ${binding.description}`);
  }
  for (const { glyph, label, description } of Object.values(badgeStyle)) {
    expect(text).toContain(`${glyph} ${label} ${description}`);
  }
  expect(text).toContain("? or esc close help");
});

test("the overlay explains clicking a story and dragging the pane line", async () => {
  const { frame } = await show(helping(), { width: 80, height: 24 });
  const text = frame().replace(/ +/g, " ");
  expect(text).toContain("Mouse");
  expect(text).toContain("click Select the story");
  expect(text).toContain("drag │ Resize the panes");
});

test("the overlay explains the marks on a changed story and on one asking for your review", async () => {
  const { frame } = await show(helping(), { width: 80, height: 24 });
  const text = frame().replace(/ +/g, " ");
  expect(text).toContain("List marks");
  expect(text).toContain("• changed since you last looked");
  expect(text).toContain("@ asks for your review");
  expect(text).toContain("⊗ is blocked ▲ blocks another story");
  expect(text).toContain("▲ blocks another story");
  expect(text).toContain("↳ is a sub-task");
  expect(text).toContain("▸5 has 5 sub-tasks");
});

test("keys that only work inside another mode stay out of the overlay", async () => {
  const { frame } = await show(helping(), { width: 80, height: 24 });
  const text = frame().replace(/ +/g, " ");
  const elsewhere = keyBindings.filter(
    (binding) => binding.modes !== "all" && !binding.modes.includes("browsing"),
  );
  expect(elsewhere.length).toBeGreaterThan(0);
  for (const binding of elsewhere) {
    expect(text).not.toContain(binding.description);
  }
});

test("the overlay fits inside 80x24 with its border intact", async () => {
  const { frame } = await show(helping(), { width: 80, height: 24 });
  const lines = frame().split("\n");
  const top = lines.findIndex((line) => line.includes("╭"));
  const bottom = lines.findIndex((line) => line.includes("╰"));
  expect(top).toBeGreaterThan(0);
  expect(bottom).toBeLessThan(23);
  expect(lines[top]).toMatch(/╭.*╮/);
  expect(lines[bottom]).toMatch(/╰.*╯/);
});

test("the bottom bar advertises help while browsing", async () => {
  const { frame } = await show(browsing(), { width: 80, height: 24 });
  expect(frame()).toContain("? help");
});

test("? opens help and ? or esc close it", async () => {
  const { screen, dispatched } = await show(browsing());
  screen.mockInput.pressKey("?");
  expect(dispatched).toEqual([{ type: "helpOpened" }]);
  const { screen: open, dispatched: whileOpen } = await show(helping());
  open.mockInput.pressKey("?");
  open.mockInput.pressEscape();
  await Bun.sleep(100);
  expect(whileOpen).toEqual([{ type: "helpClosed" }, { type: "helpClosed" }]);
});

test("other keys do nothing while help is open, and ctrl-c still quits", async () => {
  const { screen, dispatched, calls } = await show(helping());
  const { mockInput } = screen;
  for (const key of ["j", "k", "/", "r", "o", "p", "q", "x"]) mockInput.pressKey(key);
  mockInput.pressArrow("down");
  mockInput.pressArrow("up");
  mockInput.pressKey("PAGE_DOWN");
  await Bun.sleep(100);
  expect(dispatched).toEqual([]);
  expect(calls.opened).toEqual([]);
  expect(calls.quit).toBe(0);
  mockInput.pressCtrlC();
  expect(calls.quit).toBe(1);
});

test("typing ? in the query editor does not open help", async () => {
  const { screen, dispatched } = await show(
    browsing({ focus: { mode: "editingQuery", draft: "" } }),
  );
  await screen.mockInput.typeText("?");
  await Bun.sleep(100);
  expect(dispatched.some((msg) => msg.type === "helpOpened")).toBe(false);
});
