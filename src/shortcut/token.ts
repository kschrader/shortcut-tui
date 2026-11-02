import { z } from "zod";

export type TokenFailure = { kind: "missing" } | { kind: "unreadable-config"; reason: string };

export type TokenResult = { ok: true; token: string } | { ok: false; failure: TokenFailure };

export type TokenSources = {
  env: Readonly<Record<string, string | undefined>>;
  readConfigFile: () => string | null;
};

export const CONFIG_PATH_FROM_HOME = ".config/shortcut-cli/config.json";

const ConfigFile = z.object({ token: z.string() });

const nonBlank = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
};

export const resolveToken = ({ env, readConfigFile }: TokenSources): TokenResult => {
  const fromEnv = nonBlank(env["SHORTCUT_API_TOKEN"]);
  if (fromEnv !== null) return { ok: true, token: fromEnv };

  const raw = readConfigFile();
  if (raw === null) return { ok: false, failure: { kind: "missing" } };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, failure: { kind: "unreadable-config", reason: "not valid JSON" } };
  }
  const parsed = ConfigFile.safeParse(json);
  const token = parsed.success ? nonBlank(parsed.data.token) : null;
  if (token === null) {
    return {
      ok: false,
      failure: { kind: "unreadable-config", reason: 'no non-empty string "token" field' },
    };
  }
  return { ok: true, token };
};

export const describeTokenFailure = (failure: TokenFailure): string => {
  const setup = [
    'Set SHORTCUT_API_TOKEN, or put {"token": "..."} in ~/.config/shortcut-cli/config.json.',
    "Create a token at https://app.shortcut.com/settings/account/api-tokens.",
  ];
  const head =
    failure.kind === "missing"
      ? "No Shortcut API token found."
      : `Shortcut config file is unusable: ${failure.reason}.`;
  return [head, ...setup].join("\n");
};
