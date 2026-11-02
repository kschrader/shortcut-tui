#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useStoryBrowser } from "./app/runtime.ts";
import { createShortcutClient } from "./shortcut/client.ts";
import { createFakeShortcutClient } from "./shortcut/fake.ts";
import { describeTokenFailure, resolveTokenFromEnvironment } from "./shortcut/token.ts";
import type { ShortcutClient } from "./shortcut/types.ts";
import { App } from "./ui/App.tsx";

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
