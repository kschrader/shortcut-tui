import { expect, test } from "bun:test";

const closed = () =>
  new Promise<string>((resolve) => {
    setTimeout(() => resolve("escape"), 20);
  });

test("escape closes the dialog", async () => {
  expect(await closed()).toBe("escape");
});
