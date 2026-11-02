import { expect, test } from "bun:test";
import { describeTokenFailure, resolveToken } from "./token.ts";

const file = (contents: string | null) => () => contents;

test("env var wins over the config file", () => {
  const result = resolveToken({
    env: { SHORTCUT_API_TOKEN: "from-env" },
    readConfigFile: file('{"token":"from-file"}'),
  });
  expect(result).toEqual({ ok: true, token: "from-env" });
});

test("falls back to the config file token", () => {
  const result = resolveToken({ env: {}, readConfigFile: file('{"token":"from-file","x":1}') });
  expect(result).toEqual({ ok: true, token: "from-file" });
});

test("a blank env var is treated as unset", () => {
  const result = resolveToken({
    env: { SHORTCUT_API_TOKEN: "   " },
    readConfigFile: file('{"token":"from-file"}'),
  });
  expect(result).toEqual({ ok: true, token: "from-file" });
});

test("no env and no file is a missing failure with setup instructions", () => {
  const result = resolveToken({ env: {}, readConfigFile: file(null) });
  expect(result).toEqual({ ok: false, failure: { kind: "missing" } });
  if (result.ok) throw new Error("expected failure");
  const text = describeTokenFailure(result.failure);
  expect(text).toContain("SHORTCUT_API_TOKEN");
  expect(text).toContain("~/.config/shortcut-cli/config.json");
});

test.each([
  ["invalid JSON", "{nope"],
  ["missing token field", '{"other":1}'],
  ["non-string token", '{"token":5}'],
  ["empty token", '{"token":""}'],
])("a config file with %s is an unreadable-config failure", (_name, contents) => {
  const result = resolveToken({ env: {}, readConfigFile: file(contents) });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failure.kind).toBe("unreadable-config");
  expect(describeTokenFailure(result.failure)).toContain("unusable");
});

test("failure descriptions never contain the file contents", () => {
  const result = resolveToken({ env: {}, readConfigFile: file('{"token":5,"secret":"hunter2"}') });
  if (result.ok) throw new Error("expected failure");
  expect(describeTokenFailure(result.failure)).not.toContain("hunter2");
});
