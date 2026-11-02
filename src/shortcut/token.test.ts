import { expect, test } from "bun:test";
import { describeTokenFailure, resolveToken, type TokenResult } from "./token.ts";

const file = (contents: string | null) => () => contents;

const tokenOf = (result: TokenResult): string | null => (result.ok ? result.token : null);

const ENV_TOKEN = "sct_rw_acme_fromenv";
const FILE_TOKEN = "sct_rw_acme_fromfile";
const V3_TOKEN = "6f1c2a9e-4b7d-4c1a-9e2f-0a1b2c3d4e5f";

test("env var wins over the config file", () => {
  const result = resolveToken({
    env: { SHORTCUT_API_TOKEN: ENV_TOKEN },
    readConfigFile: file(JSON.stringify({ token: FILE_TOKEN })),
  });
  expect(tokenOf(result)).toBe(ENV_TOKEN);
});

test("falls back to the config file token", () => {
  const result = resolveToken({
    env: {},
    readConfigFile: file(JSON.stringify({ token: FILE_TOKEN, x: 1 })),
  });
  expect(tokenOf(result)).toBe(FILE_TOKEN);
});

test("a blank env var is treated as unset", () => {
  const result = resolveToken({
    env: { SHORTCUT_API_TOKEN: "   " },
    readConfigFile: file(JSON.stringify({ token: FILE_TOKEN })),
  });
  expect(tokenOf(result)).toBe(FILE_TOKEN);
});

test("no env and no file is a missing failure with setup instructions", () => {
  const result = resolveToken({ env: {}, readConfigFile: file(null) });
  expect(result).toEqual({ ok: false, failure: { kind: "missing" } });
  if (result.ok) throw new Error("expected failure");
  const text = describeTokenFailure(result.failure);
  expect(text).toContain("SHORTCUT_API_TOKEN");
  expect(text).toContain("~/.config/shortcut-cli/config.json");
});

test("a v3 token in the env is a not-v4 failure and does not fall back to the file", () => {
  const result = resolveToken({
    env: { SHORTCUT_API_TOKEN: V3_TOKEN },
    readConfigFile: file(JSON.stringify({ token: FILE_TOKEN })),
  });
  expect(result).toEqual({ ok: false, failure: { kind: "not-v4", source: "SHORTCUT_API_TOKEN" } });
});

test("a v3 token in the config file is a not-v4 failure naming the file", () => {
  const result = resolveToken({
    env: {},
    readConfigFile: file(JSON.stringify({ token: V3_TOKEN })),
  });
  expect(result).toEqual({ ok: false, failure: { kind: "not-v4", source: "config file" } });
  if (result.ok) throw new Error("expected failure");
  const text = describeTokenFailure(result.failure);
  expect(text).toContain("~/.config/shortcut-cli/config.json");
  expect(text).toContain("sct_");
  expect(text).toContain("https://app.shortcut.com/settings/account/api-tokens");
  expect(text).not.toContain(V3_TOKEN);
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
