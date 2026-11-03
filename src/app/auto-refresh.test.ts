import { expect, test } from "bun:test";
import { autoRefreshFromEnvironment, type AutoRefreshSetting } from "./auto-refresh.ts";

test("refreshes every 60 seconds when the variable is unset or empty", () => {
  const everyMinute: AutoRefreshSetting = { ok: true, autoRefresh: { mode: "every", ms: 60_000 } };
  expect(autoRefreshFromEnvironment({})).toEqual(everyMinute);
  expect(autoRefreshFromEnvironment({ SHORTCUT_TUI_REFRESH_SECONDS: "" })).toEqual(everyMinute);
});

test("a positive whole number of seconds sets the interval", () => {
  expect(autoRefreshFromEnvironment({ SHORTCUT_TUI_REFRESH_SECONDS: "10" })).toEqual({
    ok: true,
    autoRefresh: { mode: "every", ms: 10_000 },
  });
});

test("0 turns auto-refresh off", () => {
  expect(autoRefreshFromEnvironment({ SHORTCUT_TUI_REFRESH_SECONDS: "0" })).toEqual({
    ok: true,
    autoRefresh: { mode: "off" },
  });
});

test.each(["abc", "-5", "1.5", " 10", "1e3", "0x10"])("%p is rejected with a message", (raw) => {
  const setting = autoRefreshFromEnvironment({ SHORTCUT_TUI_REFRESH_SECONDS: raw });
  expect(setting.ok).toBe(false);
  if (!setting.ok) expect(setting.message).toContain("SHORTCUT_TUI_REFRESH_SECONDS");
});

test("an interval longer than a timer can wait is rejected instead of firing at once", () => {
  expect(autoRefreshFromEnvironment({ SHORTCUT_TUI_REFRESH_SECONDS: "2147483" })).toEqual({
    ok: true,
    autoRefresh: { mode: "every", ms: 2_147_483_000 },
  });
  expect(autoRefreshFromEnvironment({ SHORTCUT_TUI_REFRESH_SECONDS: "2147484" }).ok).toBe(false);
});
