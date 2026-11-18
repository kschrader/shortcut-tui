import { beforeEach, expect, test } from "bun:test";

let ready = false;

beforeEach(async () => {
  setTimeout(() => {
    ready = true;
  }, 5);
  await new Promise((resolve) => setTimeout(resolve, 50));
});

test("setup finished", () => {
  expect(ready).toBe(true);
});
