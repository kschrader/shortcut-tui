import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { V4_WRITE } from "./writes-from-the-list.ts";

const READS_SENT_AS_POST = new Set(["queryStories"]);

const v4Methods = (): Map<string, string> => {
  const source = readFileSync(
    join(import.meta.dir, "../node_modules/@shortcut/client/lib/generated/Api.mjs"),
    "utf8",
  );
  const methods = new Map<string, string>();
  const parts = source.split(/\n\s*(\w+)\s*=\s*\(/);
  for (let i = 1; i < parts.length; i += 2) {
    const name = parts[i] ?? "";
    const verb = /this\.request\(\{[\s\S]*?method:\s*"(\w+)"/.exec(parts[i + 1] ?? "")?.[1];
    if (verb !== undefined) methods.set(name, verb);
  }
  return methods;
};

test("the write pattern names exactly the v4 methods that change Shortcut", () => {
  const methods = v4Methods();
  expect(methods.size).toBeGreaterThan(100);
  const writes = [...methods].filter(
    ([name, verb]) => verb !== "GET" && !READS_SENT_AS_POST.has(name),
  );
  expect(writes.filter(([name]) => !V4_WRITE.test(name))).toEqual([]);
  const reads = [...methods].filter(
    ([name, verb]) => verb === "GET" || READS_SENT_AS_POST.has(name),
  );
  expect(reads.filter(([name]) => V4_WRITE.test(name))).toEqual([]);
});
