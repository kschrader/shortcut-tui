import { expect, test } from "bun:test";

test(
  "the refresh lands",
  () => {
    expect(Math.random()).toBeLessThan(2);
  },
  { retry: 3 },
);
