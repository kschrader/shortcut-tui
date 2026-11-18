import { expect, test } from "bun:test";

const pressed: string[] = [];
const pressEscape = () => setTimeout(() => pressed.push("escape"), 20);

test("escape closes the dialog", async () => {
  pressEscape();
  await Bun.sleep(100);
  expect(pressed).toEqual(["escape"]);
});
