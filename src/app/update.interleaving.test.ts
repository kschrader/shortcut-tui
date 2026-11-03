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
import {
  answerMark,
  awaitedBy,
  awaitedRequests,
  hiddenShownData,
  remoteViolations,
  slotOf,
  storyName,
} from "./interleaving.remotes.ts";
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
      return { type: "searchSucceeded", requestId, stories, loadedAt: new Date(1_000 * requestId) };
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
      const executed = world.moveOutcomes.get(requestId);
      const outcome = executed ?? succeed;
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
      if (executed === undefined) world.server.set(effect.storyId, state);
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

const userMsg = (random: Random, model: Model): Msg => {
  const shown = shownStories(model);
  const clicks: Msg[] =
    shown.length === 0 ? [] : [{ type: "storyClicked", storyId: pick(random, shown).id }];
  return pick<Msg>(random, [
    { type: "selectionMoved", delta: pick(random, [-2, -1, 1, 2]) },
    ...clicks,
    { type: "queryEditStarted" },
    { type: "queryDraftChanged", draft: pick(random, queries) },
    { type: "queryEditCancelled" },
    { type: "querySubmitted" },
    { type: "refreshRequested" },
    { type: "autoRefreshDue" },
    { type: "movePickerOpened" },
    { type: "movePickerMoved", delta: pick(random, [-1, 1]) },
    { type: "movePickerConfirmed" },
    { type: "movePickerClosed" },
    { type: "readOnlyNoticeClosed" },
  ]);
};

const violations = (model: Model, issued: readonly Effect[], world: World): string[] => {
  const found: string[] = [];
  if (new Set(issued.map((effect) => effect.requestId)).size !== issued.length) {
    found.push("two effects share a request id");
  }
  found.push(...remoteViolations(model, issued, world));
  found.push(...moveViolations(model, issued, world));
  if (model.selectedStoryId !== null && !model.details.has(model.selectedStoryId)) {
    found.push("selected story has no detail entry");
  }
  return found;
};

const explore = (seed: number): string[] => {
  const random = mulberry32(seed);
  const world: World = {
    canWrite: seed % 5 !== 0,
    server: new Map(),
    snapshots: new Map(),
    delivered: new Set(),
    moveOutcomes: new Map(),
    intents: new Map(),
    applied: new Map(),
  };
  let [model, issued] = init();
  const trail: string[] = [];
  const recordApplied = (answered: Effect): string[] => {
    const slot = slotOf(answered);
    if (slot === null || awaitedBy(model, answered) !== answered.requestId) return [];
    const previous = world.applied.get(slot);
    world.applied.set(slot, answered.requestId);
    return previous !== undefined && previous >= answered.requestId
      ? [`${slot} applied request ${String(answered.requestId)} after ${String(previous)}`]
      : [];
  };
  const apply = (msg: Msg, answered: Effect | null, succeeded: boolean) => {
    if (msg.type === "movePickerConfirmed") {
      const picked = pickedTarget(model);
      if (picked !== null) world.intents.set(picked[0], picked[1]);
    }
    const isResponse = answered !== null;
    if (isResponse && "requestId" in msg) world.delivered.add(msg.requestId);
    const outOfOrder = answered !== null && succeeded ? recordApplied(answered) : [];
    const before = model;
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
      ...outOfOrder,
      ...hiddenShownData(before, model),
      ...violations(model, issued, world),
      ...(redeliveryChanged ? ["redelivering the same response changed the model"] : []),
    ];
    return problems.map(
      (problem) => `seed ${String(seed)} after [${trail.join(", ")}]: ${problem}`,
    );
  };

  for (let step = 0; step < stepsPerSeed; step++) {
    if (random() < 0.55) {
      const effect = pick(random, issued);
      const succeed = random() < 0.8;
      const problems = apply(respond(random, effect, succeed, world, model), effect, succeed);
      if (problems.length > 0) return problems;
    } else {
      const problems = apply(userMsg(random, model), null, false);
      if (problems.length > 0) return problems;
    }
  }

  for (let round = 0; round < 10; round++) {
    const awaited = awaitedRequests(model);
    if (awaited.length === 0) break;
    for (const requestId of awaited) {
      const effect = issued.find((candidate) => candidate.requestId === requestId);
      if (effect === undefined) return [`seed ${String(seed)}: awaited request never sent`];
      const problems = apply(respond(random, effect, true, world, model), effect, true);
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
