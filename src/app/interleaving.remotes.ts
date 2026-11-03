import { shownStories, type World } from "./interleaving.moves.ts";
import type { Effect, Model, RequestId } from "./model.ts";
import { awaited, inFlight } from "./remote.ts";

export const answerMark = (requestId: number) => `answer to request ${String(requestId)}`;

export const storyName = (query: string, requestId: number, id: number) =>
  `${query}::${answerMark(requestId)}::${String(id)}`;

export type Slot = "workspace" | "search" | "prs" | `detail:${string}`;

export const slotOf = (effect: Effect): Slot | null => {
  switch (effect.type) {
    case "loadWorkspace":
      return "workspace";
    case "searchStories":
      return "search";
    case "getStory":
      return `detail:${String(effect.storyId)}`;
    case "loadPullRequests":
      return "prs";
    case "moveStory":
      return null;
  }
};

export const awaitedBy = (model: Model, effect: Effect): RequestId | null => {
  switch (effect.type) {
    case "loadWorkspace":
      return awaited(model.workspace);
    case "searchStories":
      return awaited(model.results);
    case "getStory":
      return awaited(model.details.get(effect.storyId));
    case "loadPullRequests":
      return inFlight(model.pullRequests.reload);
    case "moveStory":
      return null;
  }
};

const latest = (issued: readonly Effect[], matches: (effect: Effect) => boolean) =>
  issued.findLast(matches)?.requestId ?? null;

const marks = (requestId: RequestId | null, shown: string) =>
  requestId !== null && shown === answerMark(requestId);

const workspaceViolations = (model: Model, issued: readonly Effect[]): string[] => {
  const found: string[] = [];
  const latestLoad = latest(issued, (effect) => effect.type === "loadWorkspace");
  const { workspace } = model;
  switch (workspace.status) {
    case "firstLoad":
      if (
        issued.find((effect) => effect.requestId === workspace.requestId)?.type !== "loadWorkspace"
      ) {
        found.push("workspace waits on a request never sent");
      }
      break;
    case "failed":
      if (!marks(latestLoad, workspace.message)) {
        found.push(`workspace shows a superseded failure: ${workspace.message}`);
      }
      break;
    case "loaded":
      if (!marks(latestLoad, workspace.value.me.mentionName)) {
        found.push(`workspace shows a superseded response: ${workspace.value.me.mentionName}`);
      }
      if (workspace.reload.status !== "idle") found.push("the workspace is never reloaded");
      break;
  }
  return found;
};

const resultsViolations = (model: Model, issued: readonly Effect[], world: World): string[] => {
  const found: string[] = [];
  const latestSearch = latest(issued, (effect) => effect.type === "searchStories");
  const applied = world.applied.get("search") ?? null;
  const waitsOn = (requestId: RequestId) => {
    const effect = issued.find((candidate) => candidate.requestId === requestId);
    if (effect?.type !== "searchStories" || effect.query !== model.query) {
      found.push("results wait on a search that is not for the current query");
    }
    if (requestId !== latestSearch) found.push("results wait on a superseded search");
  };
  const { results } = model;
  switch (results.status) {
    case "firstLoad":
      waitsOn(results.requestId);
      break;
    case "failed":
      if (!marks(latestSearch, results.message)) {
        found.push(`results show a superseded search failure: ${results.message}`);
      }
      break;
    case "loaded": {
      const { query, stories } = results.value;
      if (query !== model.query) found.push(`results for "${query}" shown under "${model.query}"`);
      const stale = stories.filter(
        (story) => applied === null || story.name !== storyName(query, applied, story.id),
      );
      if (stale.length > 0) {
        found.push(
          `stories from a search other than the last applied one: ${stale[0]?.name ?? ""}`,
        );
      }
      const selected = model.selectedStoryId;
      if (selected === null && stories.length > 0) found.push("stories loaded but none selected");
      if (selected !== null && !stories.some((story) => story.id === selected)) {
        found.push(`selected story ${String(selected)} is not in the results`);
      }
      switch (results.reload.status) {
        case "idle":
          if (applied !== latestSearch)
            found.push("settled results are not from the latest search");
          break;
        case "failed":
          if (!marks(latestSearch, results.reload.message)) {
            found.push(`results show a superseded refresh failure: ${results.reload.message}`);
          }
          break;
        case "inFlight":
          waitsOn(results.reload.requestId);
          break;
      }
      break;
    }
  }
  return found;
};

const pullRequestViolations = (model: Model, issued: readonly Effect[], world: World): string[] => {
  const found: string[] = [];
  const shown = shownStories(model);
  const latestLoad = latest(issued, (effect) => effect.type === "loadPullRequests");
  const applied = world.applied.get("prs") ?? null;
  const { value, reload } = model.pullRequests;
  for (const [storyId, list] of value) {
    const story = shown.find((candidate) => candidate.id === storyId);
    if (story === undefined || story.pullRequestCount === 0) {
      found.push(`pull requests kept for story ${String(storyId)}, which is not shown linking any`);
    }
    const views = list.status === "loaded" ? list.value : [];
    const stale = views.filter((view) => applied === null || view.title !== answerMark(applied));
    if (stale.length > 0) {
      found.push(
        `pull requests from a load other than the last applied one: ${stale[0]?.title ?? ""}`,
      );
    }
  }
  switch (reload.status) {
    case "inFlight": {
      const effect = issued.find((candidate) => candidate.requestId === reload.requestId);
      const linking = shown.filter((story) => story.pullRequestCount > 0).map((story) => story.id);
      if (
        effect?.type !== "loadPullRequests" ||
        !Bun.deepEquals(
          effect.storyIds.toSorted((a, b) => a - b),
          linking.toSorted((a, b) => a - b),
        )
      ) {
        found.push("pull requests wait on a load that is not for the shown stories");
      }
      if (reload.requestId !== latestLoad) found.push("pull requests wait on a superseded load");
      break;
    }
    case "failed":
      if (!marks(latestLoad, reload.message)) {
        found.push(`pull requests show a superseded failure: ${reload.message}`);
      }
      break;
    case "idle":
      if (value.size > 0 && applied !== latestLoad) {
        found.push("settled pull requests are not from the latest load");
      }
      break;
  }
  return found;
};

const detailViolations = (model: Model, issued: readonly Effect[], world: World): string[] => {
  const found: string[] = [];
  for (const [storyId, remote] of model.details) {
    const latestFetch = latest(
      issued,
      (effect) => effect.type === "getStory" && effect.storyId === storyId,
    );
    const applied = world.applied.get(`detail:${String(storyId)}`) ?? null;
    const waitsOn = (requestId: RequestId) => {
      const effect = issued.find((candidate) => candidate.requestId === requestId);
      if (effect?.type !== "getStory" || effect.storyId !== storyId) {
        found.push(`detail ${String(storyId)} waits on a request for another story`);
      }
      if (requestId !== latestFetch)
        found.push(`detail ${String(storyId)} waits on a superseded fetch`);
    };
    switch (remote.status) {
      case "firstLoad":
        waitsOn(remote.requestId);
        break;
      case "failed":
        if (!marks(latestFetch, remote.message)) {
          found.push(`detail ${String(storyId)} shows a superseded failure: ${remote.message}`);
        }
        break;
      case "loaded":
        if (remote.value.id !== storyId) {
          found.push(`detail ${String(storyId)} holds story ${String(remote.value.id)}`);
        }
        if (!marks(applied, remote.value.description)) {
          found.push(`detail ${String(storyId)} body is not from its last applied fetch`);
        }
        switch (remote.reload.status) {
          case "idle":
            if (applied !== latestFetch) {
              found.push(`detail ${String(storyId)} settled on a superseded fetch`);
            }
            break;
          case "failed":
            if (!marks(latestFetch, remote.reload.message)) {
              found.push(`detail ${String(storyId)} shows a superseded refresh failure`);
            }
            break;
          case "inFlight":
            waitsOn(remote.reload.requestId);
            break;
        }
        break;
    }
  }
  return found;
};

export const remoteViolations = (
  model: Model,
  issued: readonly Effect[],
  world: World,
): string[] => [
  ...workspaceViolations(model, issued),
  ...resultsViolations(model, issued, world),
  ...pullRequestViolations(model, issued, world),
  ...detailViolations(model, issued, world),
];

export const hiddenShownData = (before: Model, after: Model): string[] => {
  if (before.query !== after.query) return [];
  const found: string[] = [];
  if (before.results.status === "loaded" && after.results.status !== "loaded") {
    found.push("a step hid the shown results without changing the query");
  }
  for (const [storyId, remote] of before.details) {
    if (remote.status === "loaded" && after.details.get(storyId)?.status !== "loaded") {
      found.push(`a step hid the shown detail of story ${String(storyId)}`);
    }
  }
  const shownAfter = shownStories(after);
  for (const storyId of before.pullRequests.value.keys()) {
    const still = shownAfter.find((story) => story.id === storyId);
    if (
      still !== undefined &&
      still.pullRequestCount > 0 &&
      !after.pullRequests.value.has(storyId)
    ) {
      found.push(`a step dropped the kept pull request status of story ${String(storyId)}`);
    }
  }
  return found;
};

export const awaitedRequests = (model: Model): RequestId[] =>
  [
    awaited(model.workspace),
    awaited(model.results),
    inFlight(model.pullRequests.reload),
    ...[...model.details.values()].map((remote) => awaited(remote)),
    ...[...model.moves.values()].map((move) => (move.status === "saving" ? move.requestId : null)),
  ].filter((id): id is RequestId => id !== null);
