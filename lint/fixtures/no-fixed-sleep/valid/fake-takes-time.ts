import { expect, test } from "bun:test";

const slowFake = {
  listPullRequests: async () => {
    await Bun.sleep(1);
    return [];
  },
};

test("a slow fake still answers", async () => {
  expect(await slowFake.listPullRequests()).toEqual([]);
});
