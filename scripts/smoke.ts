import { systemClock } from "../src/app/clock.ts";
import type { Model, StoryPullRequests } from "../src/app/model.ts";
import { createStoryStore } from "../src/app/store.ts";
import { createGitHubClient } from "../src/github/client.ts";
import { storyMergeStatus } from "../src/github/pull-request-state.ts";
import { createShortcutClient } from "../src/shortcut/client.ts";
import { describeTokenFailure, resolveTokenFromEnvironment } from "../src/shortcut/token.ts";

const say = (line: string) => process.stdout.write(`${line}\n`);

const settled = (model: Model): boolean => {
  if (model.workspace.status !== "loaded") return model.workspace.status === "failed";
  if (model.results.status !== "loaded") return model.results.status === "failed";
  if (model.pullRequests.status === "loading") return false;
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
  const { pullRequests } = model;
  if (pullRequests.status === "failed") say(`pull requests failed: ${pullRequests.message}`);
  const linked: StoryPullRequests =
    pullRequests.status === "loaded" ? pullRequests.value : new Map();
  for (const story of stories) {
    const list = linked.get(story.id);
    if (list?.status === "failed")
      say(`  pull requests failed for ${String(story.id)}: ${list.message}`);
    const views = list?.status === "loaded" ? list.value : [];
    const status = storyMergeStatus(views.map((pr) => pr.state));
    say(`  ${story.state.name.padEnd(20)} ${status.padEnd(17)} ${String(story.id)} ${story.name}`);
    for (const pr of views) {
      say(`      #${String(pr.github?.number ?? "?")} ${pr.state.padEnd(17)} ${pr.title}`);
    }
  }
  if (pullRequests.status === "failed") return false;
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
  const store = createStoryStore(
    {
      shortcut: createShortcutClient({ token: tokenResult.token }),
      github: createGitHubClient(),
    },
    { clock: systemClock, autoRefresh: { mode: "off" } },
  );
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
