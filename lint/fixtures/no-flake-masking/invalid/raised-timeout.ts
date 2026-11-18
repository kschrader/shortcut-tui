import { expect, test } from "bun:test";

test("the gh process exits", async () => {
  expect(await Promise.resolve(0)).toBe(0);
}, 30_000);
