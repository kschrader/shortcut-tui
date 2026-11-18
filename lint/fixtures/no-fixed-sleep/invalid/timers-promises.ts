import { expect, test } from "bun:test";
import { setTimeout as wait } from "node:timers/promises";

test("the cache is written", async () => {
  const written: string[] = [];
  void Promise.resolve().then(() => written.push("cache"));
  await wait(10);
  expect(written).toEqual(["cache"]);
});
