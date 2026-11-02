import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export type ApiToken = string & { readonly brand: "ApiToken" };

export type TokenSource = "SHORTCUT_API_TOKEN" | "config file";

export type TokenFailure =
  | { kind: "missing" }
  | { kind: "unreadable-config"; reason: string }
  | { kind: "not-v4"; source: TokenSource };

export type TokenResult = { ok: true; token: ApiToken } | { ok: false; failure: TokenFailure };

export type TokenSources = {
  env: Readonly<Record<string, string | undefined>>;
  readConfigFile: () => string | null;
};

const CONFIG_PATH = "~/.config/shortcut-cli/config.json";

const ConfigFile = z.object({ token: z.string() });

const nonBlank = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
};

const isApiToken = (value: string): value is ApiToken => /^sct_\S+$/.test(value);

const v4Token = (value: string, source: TokenSource): TokenResult =>
  isApiToken(value)
    ? { ok: true, token: value }
    : { ok: false, failure: { kind: "not-v4", source } };

export const resolveToken = ({ env, readConfigFile }: TokenSources): TokenResult => {
  const fromEnv = nonBlank(env["SHORTCUT_API_TOKEN"]);
  if (fromEnv !== null) return v4Token(fromEnv, "SHORTCUT_API_TOKEN");

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
  return v4Token(token, "config file");
};

const readShortcutCliConfig = (): string | null => {
  try {
    return readFileSync(join(homedir(), ".config", "shortcut-cli", "config.json"), "utf8");
  } catch {
    return null;
  }
};

export const resolveTokenFromEnvironment = (): TokenResult =>
  resolveToken({ env: process.env, readConfigFile: readShortcutCliConfig });

const headline = (failure: TokenFailure): string => {
  switch (failure.kind) {
    case "missing":
      return "No Shortcut API token found.";
    case "unreadable-config":
      return `Shortcut config file is unusable: ${failure.reason}.`;
    case "not-v4":
      return `The token from ${failure.source === "config file" ? CONFIG_PATH : failure.source} is not a REST API v4 token.`;
  }
};

export const describeTokenFailure = (failure: TokenFailure): string =>
  [
    headline(failure),
    `Set SHORTCUT_API_TOKEN, or put {"token": "..."} in ${CONFIG_PATH}.`,
    "v4 API tokens start with sct_. Create one at https://app.shortcut.com/settings/account/api-tokens.",
  ].join("\n");
