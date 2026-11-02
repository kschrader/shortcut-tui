#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { Clients } from "./app/effects.ts";
import { useStoryBrowser } from "./app/runtime.ts";
import { createGitHubClient } from "./github/client.ts";
import { createFakeGitHubClient } from "./github/fake.ts";
import { createShortcutClient } from "./shortcut/client.ts";
import { createFakeShortcutClient } from "./shortcut/fake.ts";
import { describeTokenFailure, resolveTokenFromEnvironment } from "./shortcut/token.ts";
import { App } from "./ui/App.tsx";

const DEMO_MOVE_DELAY_MS = 1500;

const openUrl = (url: string) => {
  Bun.spawn([process.platform === "darwin" ? "open" : "xdg-open", url], {
    stdio: ["ignore", "ignore", "ignore"],
  });
};

const main = async () => {
  const demo = process.argv.includes("--demo");
  const tokenResult = demo ? null : resolveTokenFromEnvironment();
  if (tokenResult !== null && !tokenResult.ok) {
    process.stderr.write(
      `${describeTokenFailure(tokenResult.failure)}\nOr run with --demo to try sample data.\n`,
    );
    process.exitCode = 1;
    return;
  }
  const clients: Clients =
    tokenResult === null
      ? {
          shortcut: createFakeShortcutClient({ moveDelayMs: DEMO_MOVE_DELAY_MS }),
          github: createFakeGitHubClient(),
        }
      : {
          shortcut: createShortcutClient({ token: tokenResult.token }),
          github: createGitHubClient(),
        };
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const Root = () => {
    const { model, dispatch } = useStoryBrowser(clients);
    return (
      <App model={model} dispatch={dispatch} quit={() => renderer.destroy()} openUrl={openUrl} />
    );
  };
  createRoot(renderer).render(<Root />);
};

await main();
