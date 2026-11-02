import type { Model } from "../src/app/model.ts";
import { createStoryStore } from "../src/app/store.ts";
import { createGitHubClient } from "../src/github/client.ts";
import { createShortcutClient } from "../src/shortcut/client.ts";
import { describeTokenFailure, resolveTokenFromEnvironment } from "../src/shortcut/token.ts";

const say = (line: string) => process.stdout.write(`${line}\n`);

const settled = (model: Model): boolean => {
  if (model.workspace.status !== "loaded") return model.workspace.status === "failed";
  if (model.results.status !== "loaded") return model.results.status === "failed";
  if (model.selectedStoryId === null) return true;
  return model.details.get(model.selectedStoryId)?.status !== "loading";
};

const report = (model: Model): boolean => {
  if (model.workspace.status === "failed") {
    say(`workspace failed: ${model.workspace.message}`);
    return false;
  }
  if (model.results.status !== "loaded") {
    say(
      `search failed: ${model.results.status === "failed" ? model.results.message : "unsettled"}`,
    );
    return false;
  }
  const { stories } = model.results.value;
  say(`search: ${stories.length} stories`);
  for (const story of stories) say(`  ${story.name}`);
  const detail =
    model.selectedStoryId === null ? undefined : model.details.get(model.selectedStoryId);
  if (detail === undefined) return stories.length === 0;
  if (detail.status !== "loaded") {
    say(`detail failed: ${detail.status === "failed" ? detail.message : "unsettled"}`);
    return false;
  }
  const story = detail.value;
  say(
    `detail: ${story.name}: ${story.owners.length} owners, ${story.labels.length} labels, ${story.comments.length} comments, ${story.description.length} description chars`,
  );
  return true;
};

const tokenResult = resolveTokenFromEnvironment();
if (tokenResult.ok) {
  const store = createStoryStore({
    shortcut: createShortcutClient({ token: tokenResult.token }),
    github: createGitHubClient(),
  });
  const model = await new Promise<Model>((resolve) => {
    const unsubscribe = store.subscribe(() => {
      const current = store.getModel();
      if (!settled(current)) return;
      unsubscribe();
      resolve(current);
    });
    store.start();
  });
  process.exitCode = report(model) ? 0 : 1;
} else {
  process.stderr.write(`${describeTokenFailure(tokenResult.failure)}\n`);
  process.exitCode = 1;
}
