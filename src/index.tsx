#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useEffect } from "react";
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
          shortcut: createFakeShortcutClient({
            moveDelayMs: DEMO_MOVE_DELAY_MS,
            teammateMovesOnRefresh: true,
          }),
          github: createFakeGitHubClient(),
        }
      : {
          shortcut: createShortcutClient({ token: tokenResult.token }),
          github: createGitHubClient(),
        };
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const copyText = (text: string) => {
    const sent = renderer.copyToClipboardOSC52(text);
    if (process.platform !== "darwin") return sent;
    return Bun.spawnSync(["pbcopy"], { stdin: Buffer.from(text) }).exitCode === 0;
  };
  const Root = () => {
    const { model, dispatch, now } = useStoryBrowser(clients, {
      clock: systemClock,
      autoRefresh: refresh.autoRefresh,
    });
    useEffect(() => {
      const focused = () => dispatch({ type: "terminalFocused", at: systemClock.now() });
      renderer.on("focus", focused);
      return () => {
        renderer.off("focus", focused);
      };
    }, [dispatch]);
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
