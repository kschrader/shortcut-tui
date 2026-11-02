import { expect, test } from "bun:test";
import { z } from "zod";
import type { PullRequestId } from "../shortcut/types.ts";
import { detail, summary, workspaceFor } from "./fixtures.ts";
import {
  moveViolations,
  pickedTarget,
  serverState,
  shownStories,
  stateById,
  type World,
} from "./interleaving.moves.ts";
import type { Effect, Model, Msg, PullRequestView } from "./model.ts";
import { init, update } from "./update.ts";

const seeds = 300;
const stepsPerSeed = 200;
const queries = ["is:started", "label:urgent", ""];
const storyPool = [1, 2, 3, 4];

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

type Random = ReturnType<typeof mulberry32>;

const pick = <T>(random: Random, items: readonly T[]): T => {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("pick from empty list");
  return item;
};

const answerMark = (requestId: number) => `answer to request ${String(requestId)}`;
const storyName = (query: string, requestId: number, id: number) =>
  `${query}::${answerMark(requestId)}::${String(id)}`;

const pullRequestAnswer = (requestId: number, index: number): PullRequestView => ({
  id: z.custom<PullRequestId>().parse(index + 1),
  title: answerMark(requestId),
  url: `https://github.com/acme/app/pull/${String(index + 1)}`,
  closed: false,
  draft: false,
  github: { owner: "acme", repo: "app", number: index + 1 },
  state: "ready",
});

const respond = (
  random: Random,
  effect: Effect,
  succeed: boolean,
  world: World,
  model: Model,
): Msg => {
  const { requestId } = effect;
  switch (effect.type) {
    case "loadWorkspace":
      return succeed
        ? {
            type: "workspaceLoaded",
            requestId,
            workspace: workspaceFor(answerMark(requestId), world.canWrite),
          }
        : { type: "workspaceFailed", requestId, message: answerMark(requestId) };
    case "searchStories": {
      if (!succeed) return { type: "searchFailed", requestId, message: answerMark(requestId) };
      const seen = random() < 0.5 ? (world.snapshots.get(requestId) ?? world.server) : world.server;
      const ids = storyPool.filter(() => random() < 0.6).toSorted(() => random() - 0.5);
      const stories = ids.map((id) => ({
        ...summary(id, storyName(effect.query, requestId, id)),
        pullRequestCount: random() < 0.5 ? 0 : 1 + Math.floor(random() * 2),
        state: serverState(seen, summary(id).id),
      }));
      return { type: "searchSucceeded", requestId, stories };
    }
    case "getStory":
      return succeed
        ? {
            type: "detailSucceeded",
            requestId,
            story: { ...detail(effect.storyId), description: answerMark(requestId) },
          }
        : {
            type: "detailFailed",
            requestId,
            storyId: effect.storyId,
            message: answerMark(requestId),
          };
    case "loadPullRequests":
      return succeed
        ? {
            type: "pullRequestsLoaded",
            requestId,
            pullRequests: new Map(
              effect.storyIds.map((id, index) => [
                id,
                { status: "loaded", value: [pullRequestAnswer(requestId, index)] },
              ]),
            ),
          }
        : { type: "pullRequestsFailed", requestId, message: answerMark(requestId) };
    case "moveStory": {
      const outcome = world.moveOutcomes.get(requestId) ?? succeed;
      world.moveOutcomes.set(requestId, outcome);
      if (!outcome) {
        return {
          type: "moveFailed",
          requestId,
          storyId: effect.storyId,
          message: answerMark(requestId),
        };
      }
      const state = stateById(effect.stateId);
      world.server.set(effect.storyId, state);
      const shown = shownStories(model).find((story) => story.id === effect.storyId);
      return {
        type: "moveSucceeded",
        requestId,
        storyId: effect.storyId,
        story: {
          ...(shown ?? summary(effect.storyId)),
          state,
          updatedAt: new Date(1_000 * requestId),
        },
      };
    }
  }
};

const userMsg = (random: Random): Msg =>
  pick<Msg>(random, [
    { type: "selectionMoved", delta: pick(random, [-2, -1, 1, 2]) },
    { type: "queryEditStarted" },
    { type: "queryDraftChanged", draft: pick(random, queries) },
    { type: "queryEditCancelled" },
    { type: "querySubmitted" },
    { type: "refreshRequested" },
    { type: "movePickerOpened" },
    { type: "movePickerMoved", delta: pick(random, [-1, 1]) },
    { type: "movePickerConfirmed" },
    { type: "movePickerClosed" },
    { type: "readOnlyNoticeClosed" },
  ]);

const pullRequestViolations = (model: Model, issued: readonly Effect[]): string[] => {
  const found: string[] = [];
  const shown = shownStories(model);
  const latest = issued.findLast((effect) => effect.type === "loadPullRequests");
  const { pullRequests } = model;
  switch (pullRequests.status) {
    case "loading": {
      const effect = issued.find((candidate) => candidate.requestId === pullRequests.requestId);
      const linking = shown.filter((story) => story.pullRequestCount > 0);
      if (
        effect?.type !== "loadPullRequests" ||
        !Bun.deepEquals(
          effect.storyIds.toSorted((a, b) => a - b),
          linking.map((story) => story.id).toSorted((a, b) => a - b),
        )
      ) {
        found.push("pull requests wait on a load that is not for the shown stories");
      }
      break;
    }
    case "loaded":
      for (const [storyId, list] of pullRequests.value) {
        const views = list.status === "loaded" ? list.value : [];
        if (!shown.some((story) => story.id === storyId)) {
          found.push(
            `pull requests shown for story ${String(storyId)}, which is not in the results`,
          );
        }
        const stale = views.filter(
          (view) => latest === undefined || view.title !== answerMark(latest.requestId),
        );
        if (stale.length > 0)
          found.push(`pull requests from a superseded load: ${stale[0]?.title ?? ""}`);
      }
      break;
    case "failed":
      if (latest === undefined || pullRequests.message !== answerMark(latest.requestId)) {
        found.push(`pull requests show a superseded failure: ${pullRequests.message}`);
      }
      break;
  }
  return found;
};

const violations = (model: Model, issued: readonly Effect[], world: World): string[] => {
  const found: string[] = [];
  const issuedById = new Map(issued.map((effect) => [effect.requestId, effect]));
  if (issuedById.size !== issued.length) found.push("two effects share a request id");

  if (model.results.status === "loaded") {
    const { query, stories } = model.results.value;
    if (query !== model.query) found.push(`results for "${query}" shown under "${model.query}"`);
    const latest = issued.findLast((effect) => effect.type === "searchStories");
    const stale = stories.filter(
      (story) =>
        latest?.type !== "searchStories" ||
        story.name !== storyName(model.query, latest.requestId, story.id),
    );
    if (stale.length > 0) found.push(`stories from a superseded search: ${stale[0]?.name ?? ""}`);
    const selected = model.selectedStoryId;
    if (selected === null && stories.length > 0) found.push("stories loaded but none selected");
    if (selected !== null && !stories.some((story) => story.id === selected)) {
      found.push(`selected story ${String(selected)} is not in the results`);
    }
  }
  if (model.results.status === "failed") {
    const latest = issued.findLast((effect) => effect.type === "searchStories");
    if (latest === undefined || model.results.message !== answerMark(latest.requestId)) {
      found.push(`results show a superseded search failure: ${model.results.message}`);
    }
  }
  if (model.workspace.status !== "loading") {
    const latest = issued.findLast((effect) => effect.type === "loadWorkspace");
    const shown =
      model.workspace.status === "loaded"
        ? model.workspace.value.me.mentionName
        : model.workspace.message;
    if (latest === undefined || shown !== answerMark(latest.requestId)) {
      found.push(`workspace shows a superseded response: ${shown}`);
    }
  }
  found.push(...pullRequestViolations(model, issued));
  found.push(...moveViolations(model, issued, world));
  if (model.selectedStoryId !== null && !model.details.has(model.selectedStoryId)) {
    found.push("selected story has no detail entry");
  }

  if (model.workspace.status === "loading") {
    const effect = issuedById.get(model.workspace.requestId);
    if (effect?.type !== "loadWorkspace") found.push("workspace waits on a request never sent");
  }
  if (model.results.status === "loading") {
    const effect = issuedById.get(model.results.requestId);
    if (effect?.type !== "searchStories" || effect.query !== model.query) {
      found.push("results wait on a search that is not for the current query");
    }
  }
  for (const [storyId, remote] of model.details) {
    if (remote.status === "loading") {
      const effect = issuedById.get(remote.requestId);
      if (effect?.type !== "getStory" || effect.storyId !== storyId) {
        found.push(`detail ${String(storyId)} waits on a request for another story`);
      }
    }
    if (remote.status === "loaded" && remote.value.id !== storyId) {
      found.push(`detail ${String(storyId)} holds story ${String(remote.value.id)}`);
    }
    if (remote.status !== "loading") {
      const latest = issued.findLast(
        (effect) => effect.type === "getStory" && effect.storyId === storyId,
      );
      const shown = remote.status === "loaded" ? remote.value.description : remote.message;
      if (latest === undefined || shown !== answerMark(latest.requestId)) {
        found.push(`detail ${String(storyId)} shows a superseded response: ${shown}`);
      }
    }
  }
  return found;
};

const awaitedRequests = (model: Model) => [
  ...(model.workspace.status === "loading" ? [model.workspace.requestId] : []),
  ...(model.results.status === "loading" ? [model.results.requestId] : []),
  ...(model.pullRequests.status === "loading" ? [model.pullRequests.requestId] : []),
  ...[...model.details.values()].flatMap((remote) =>
    remote.status === "loading" ? [remote.requestId] : [],
  ),
  ...[...model.moves.values()].flatMap((move) =>
    move.status === "saving" ? [move.requestId] : [],
  ),
];

const explore = (seed: number): string[] => {
  const random = mulberry32(seed);
  const world: World = {
    canWrite: seed % 5 !== 0,
    server: new Map(),
    snapshots: new Map(),
    delivered: new Set(),
    moveOutcomes: new Map(),
    intents: new Map(),
  };
  let [model, issued] = init();
  const trail: string[] = [];
  const apply = (msg: Msg, isResponse: boolean) => {
    if (msg.type === "movePickerConfirmed") {
      const picked = pickedTarget(model);
      if (picked !== null) world.intents.set(picked[0], picked[1]);
    }
    if (isResponse && "requestId" in msg) world.delivered.add(msg.requestId);
    const [next, effects] = update(model, msg);
    model = next;
    issued = [...issued, ...effects];
    for (const effect of effects) {
      if (effect.type === "searchStories") {
        world.snapshots.set(effect.requestId, new Map(world.server));
      }
    }
    trail.push(msg.type);
    const [redelivered, redeliveryEffects] = update(model, msg);
    const redeliveryChanged =
      isResponse && (redeliveryEffects.length > 0 || !Bun.deepEquals(redelivered, model));
    const problems = [
      ...violations(model, issued, world),
      ...(redeliveryChanged ? ["redelivering the same response changed the model"] : []),
    ];
    return problems.map(
      (problem) => `seed ${String(seed)} after [${trail.join(", ")}]: ${problem}`,
    );
  };

  for (let step = 0; step < stepsPerSeed; step++) {
    const deliver = random() < 0.55;
    const msg = deliver
      ? respond(random, pick(random, issued), random() < 0.8, world, model)
      : userMsg(random);
    const problems = apply(msg, deliver);
    if (problems.length > 0) return problems;
  }

  for (let round = 0; round < 10; round++) {
    const awaited = awaitedRequests(model);
    if (awaited.length === 0) break;
    for (const requestId of awaited) {
      const effect = issued.find((candidate) => candidate.requestId === requestId);
      if (effect === undefined) return [`seed ${String(seed)}: awaited request never sent`];
      const problems = apply(respond(random, effect, true, world, model), true);
      if (problems.length > 0) return problems;
    }
  }
  if (awaitedRequests(model).length > 0) {
    return [`seed ${String(seed)}: requests still loading after every response was delivered`];
  }
  const unsettled = shownStories(model).filter(
    (story) => story.state.id !== serverState(world.server, story.id).id,
  );
  return unsettled.map(
    (story) =>
      `seed ${String(seed)} settled with story ${String(story.id)} showing ${story.state.name} while the server has ${serverState(world.server, story.id).name}`,
  );
};

test("random interleavings of user input, moves and reordered, duplicated responses keep the invariants", () => {
  const problems = Array.from({ length: seeds }, (_, seed) => explore(seed)).flat();
  expect(problems).toEqual([]);
});
