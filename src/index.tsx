#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { useStoryBrowser } from "./app/runtime.ts";
import { createShortcutClient } from "./shortcut/client.ts";
import { createFakeShortcutClient } from "./shortcut/fake.ts";
import { describeTokenFailure, resolveToken } from "./shortcut/token.ts";
import type { ShortcutClient } from "./shortcut/types.ts";
import { App } from "./ui/App.tsx";

const openUrl = (url: string) => {
  Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url], {
    stdio: ["ignore", "ignore", "ignore"],
  });
};

const readConfigFile = () => {
  try {
    return readFileSync(join(homedir(), ".config", "shortcut-cli", "config.json"), "utf8");
  } catch {
    return null;
  }
};

const main = async () => {
  const demo = process.argv.includes("--demo");
  const tokenResult = demo ? null : resolveToken({ env: process.env, readConfigFile });
  if (tokenResult !== null && !tokenResult.ok) {
    process.stderr.write(
      `${describeTokenFailure(tokenResult.failure)}\nOr run with --demo to try sample data.\n`,
    );
    process.exitCode = 1;
    return;
  }
  const client: ShortcutClient =
    tokenResult === null
      ? createFakeShortcutClient()
      : createShortcutClient({
          token: tokenResult.token,
          baseUrl: "https://api.app.shortcut.com",
          fetch,
        });
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const Root = () => {
    const { model, dispatch } = useStoryBrowser(client);
    return (
      <App model={model} dispatch={dispatch} quit={() => renderer.destroy()} openUrl={openUrl} />
    );
  };
  createRoot(renderer).render(<Root />);
};

await main();
