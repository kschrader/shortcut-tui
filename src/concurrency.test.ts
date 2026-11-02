import { expect, test } from "bun:test";
import { settleLimited } from "./concurrency.ts";

test("results come back in input order however the tasks interleave", async () => {
  const settled = await settleLimited([30, 1, 20, 2, 10], 2, async (ms) => {
    await Bun.sleep(ms);
    if (ms === 20) throw new Error("twenty");
    return ms * 10;
  });
  expect(settled).toEqual([
    { status: "fulfilled", value: 300 },
    { status: "fulfilled", value: 10 },
    { status: "rejected", reason: new Error("twenty") },
    { status: "fulfilled", value: 20 },
    { status: "fulfilled", value: 100 },
  ]);
});

test("no items settle to nothing", async () => {
  expect(await settleLimited([], 3, async () => 1)).toEqual([]);
});
