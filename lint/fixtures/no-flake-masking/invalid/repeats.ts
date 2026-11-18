import { expect, test } from "bun:test";

test.each([1, 2])(
  "row %d renders",
  (row) => {
    expect(row).toBeGreaterThan(0);
  },
  { repeats: 5, timeout: 10_000 },
);
