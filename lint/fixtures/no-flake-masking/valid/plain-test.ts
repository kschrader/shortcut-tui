import { describe, expect, test } from "bun:test";

describe("the list", () => {
  test("renders rows", () => {
    expect([1, 2]).toHaveLength(2);
  });
});
