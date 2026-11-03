#!/usr/bin/env bun
import { type CliRenderer, createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { autoRefreshFromEnvironment } from "./app/auto-refresh.ts";
import { systemClock } from "./app/clock.ts";
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

const copyTextWith = (renderer: CliRenderer) => (text: string) => {
  if (renderer.copyToClipboardOSC52(text)) return true;
  if (process.platform !== "darwin") return false;
  Bun.spawn(["pbcopy"], { stdin: new Blob([text]), stdout: "ignore", stderr: "ignore" });
  return true;
};

const main = async () => {
  const demo = process.argv.includes("--demo");
  const refresh = autoRefreshFromEnvironment();
  if (!refresh.ok) {
    process.stderr.write(`${refresh.message}\n`);
    process.exitCode = 1;
    return;
  }
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
  const copyText = copyTextWith(renderer);
  const Root = () => {
    const { model, dispatch, now } = useStoryBrowser(clients, {
      clock: systemClock,
      autoRefresh: refresh.autoRefresh,
    });
    return (
      <App
        model={model}
        now={now}
        dispatch={dispatch}
        quit={() => renderer.destroy()}
        openUrl={openUrl}
        copyText={copyText}
      />
    );
  };
  createRoot(renderer).render(<Root />);
};

await main();
