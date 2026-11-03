export type AutoRefresh = { mode: "off" } | { mode: "every"; ms: number };

const REFRESH_SECONDS_VARIABLE = "SHORTCUT_TUI_REFRESH_SECONDS";

const DEFAULT_SECONDS = 60;
const LONGEST_TIMER_MS = 2 ** 31 - 1;
const LONGEST_SECONDS = Math.floor(LONGEST_TIMER_MS / 1000);

export type AutoRefreshSetting =
  | { ok: true; autoRefresh: AutoRefresh }
  | { ok: false; message: string };

export const autoRefreshFromEnvironment = (
  env: Record<string, string | undefined> = process.env,
): AutoRefreshSetting => {
  const raw = env[REFRESH_SECONDS_VARIABLE];
  if (raw === undefined || raw === "") {
    return { ok: true, autoRefresh: { mode: "every", ms: DEFAULT_SECONDS * 1000 } };
  }
  if (!/^\d+$/.test(raw) || Number(raw) > LONGEST_SECONDS) {
    return {
      ok: false,
      message: `${REFRESH_SECONDS_VARIABLE} must be a whole number of seconds from 1 to ${String(LONGEST_SECONDS)}, or 0 to turn auto-refresh off. It is "${raw}".`,
    };
  }
  const seconds = Number(raw);
  return {
    ok: true,
    autoRefresh: seconds === 0 ? { mode: "off" } : { mode: "every", ms: seconds * 1000 },
  };
};
