import { expect, test } from "bun:test";
import { z } from "zod";
import type { PullRequestState } from "../github/types.ts";
import type { PullRequestId, StorySummary } from "../shortcut/types.ts";
import { groupingOf } from "./filters.ts";
import { detail, doing, finished, ownedBy, summary, toDo, workspaceFor } from "./fixtures.ts";
import {
  answerMove,
  conflictViolations,
  listedStories,
  moveViolations,
  newWorld,
  pickedTarget,
  searchApplied,
  searchSent,
  serverState,
  searchedStories,
  shortcutReads,
  teammateMoves,
  type MoveEffect,
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
import { changesOf, unseenChanges } from "./glance.ts";
import type { RemoteRequest, Model, Msg, PullRequestView } from "./model.ts";
import { orderFor } from "./order.ts";
import { requestsIn } from "./remote.ts";
import { shownStories } from "./rows.ts";
import { init, update } from "./update.ts";

const seeds = 300;
const DAY_MS = 86_400_000;
const stepsPerSeed = 200;
const queries = ["is:started", "label:urgent", ""];
const answeredStates: readonly PullRequestState[] = [
  "ready",
  "checks-running",
  "unknown",
  "merged",
  "closed",
];
const storyPool = [1, 2, 3, 4];
const teammateStates = [toDo, doing, finished];
const ownersInPool: Record<number, readonly string[]> = {
  1: ["Zed"],
  2: ["Zed", "Ann"],
  3: [],
  4: ["Ann"],
};

const pooled = (id: number, name?: string): StorySummary =>
  ownedBy(summary(id, name), ...(ownersInPool[id] ?? []));

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

const pullRequestAnswer = (
  requestId: number,
  index: number,
  state: PullRequestState,
): PullRequestView => ({
  id: z.custom<PullRequestId>().parse(index + 1),
  title: answerMark(requestId),
  url: `https://github.com/acme/app/pull/${String(index + 1)}`,
  closed: false,
  draft: false,
  github: { owner: "acme", repo: "app", number: index + 1 },
  state,
  reviews: null,
  optionalFailing: [],
});

const respond = (
  random: Random,
  effect: RemoteRequest,
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
        ...pooled(id, storyName(effect.queries, requestId, id)),
        pullRequestCount: random() < 0.5 ? 0 : 1 + Math.floor(random() * 2),
        state: serverState(seen, summary(id).id),
        updatedAt: random() < 0.3 ? new Date(1_000 * requestId) : summary(id).updatedAt,
        movedAt: random() < 0.3 ? new Date(1_000 * requestId) : summary(id).movedAt,
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
                {
                  status: "loaded",
                  value: Array.from({ length: 1 + Math.floor(random() * 2) }, (_, nth) =>
                    pullRequestAnswer(requestId, 2 * index + nth, pick(random, answeredStates)),
                  ),
                },
              ]),
            ),
          }
        : { type: "pullRequestsFailed", requestId, message: answerMark(requestId) };
    case "moveStory": {
      const { storyId } = effect;
      const answer = answerMove(world, effect, succeed);
      const shown = searchedStories(model).find((story) => story.id === storyId);
      const held = (state: StorySummary["state"]): StorySummary => ({
        ...(shown ?? pooled(storyId)),
        state,
        updatedAt: new Date(1_000 * requestId),
        movedAt: new Date(1_000 * requestId),
      });
      switch (answer.kind) {
        case "refused":
          return { type: "moveFailed", requestId, storyId, message: answerMark(requestId) };
        case "conflict":
          return { type: "moveConflicted", requestId, storyId, story: held(answer.found) };
        case "moved":
          return { type: "moveSucceeded", requestId, storyId, story: held(answer.state) };
      }
    }
  }
};

const userMsg = (random: Random, model: Model): Msg => {
  const shown = searchedStories(model);
  const clicks: Msg[] =
    shown.length === 0 ? [] : [{ type: "storyClicked", storyId: pick(random, shown).id }];
  return pick<Msg>(random, [
    { type: "selectionMoved", delta: pick(random, [-2, -1, 1, 2]) },
    ...clicks,
    { type: "queryEditStarted" },
    { type: "queryDraftChanged", draft: pick(random, queries) },
    { type: "queryEditCancelled" },
    { type: "querySubmitted" },
    { type: "filterCycled" },
    { type: "ageFloorToggled", at: new Date(Math.floor(random() * 3 * DAY_MS)) },
    { type: "refreshRequested" },
    { type: "autoRefreshDue" },
    { type: "terminalFocused", at: new Date(Math.floor(random() * 1_000 * stepsPerSeed)) },
    { type: "movePickerOpened" },
    { type: "movePickerMoved", delta: pick(random, [-1, 1]) },
    { type: "movePickerConfirmed" },
    { type: "movePickerClosed" },
    { type: "readOnlyNoticeClosed" },
  ]);
};

const pickingMsgs = (random: Random): Msg[] => [
  { type: "movePickerOpened" },
  { type: "movePickerMoved", delta: pick(random, [-2, -1, 1, 2]) },
  { type: "movePickerConfirmed" },
];

const glanceViolations = (before: Model, after: Model): string[] => {
  const found: string[] = [];
  const shown = searchedStories(after);
  const selected = after.selectedStoryId;
  if (selected !== null && unseenChanges(after).has(selected)) {
    found.push(`selected story ${String(selected)} carries a change mark`);
  }
  if (before.results.status === "firstLoad" && after.results.status === "loaded") {
    const marked = shown.filter((story) => changesOf(after, story.id).length > 0);
    if (marked.length > 0) found.push("results for a new question marked a change");
  }
  const left = before.selectedStoryId;
  if (left !== null && left !== selected && changesOf(after, left).length > 0) {
    found.push(`story ${String(left)} carries a change right after you left it`);
  }
  for (const story of shown) {
    const own = changesOf(after, story.id).filter((change) => change.kind !== "pullRequests");
    if (after.moves.has(story.id) && own.length > 0) {
      found.push(`story ${String(story.id)} you are moving carries ${own[0]?.kind ?? ""}`);
    }
  }
  return found;
};

const violations = (model: Model, issued: readonly RemoteRequest[], world: World): string[] => {
  const found: string[] = [];
  if (new Set(issued.map((effect) => effect.requestId)).size !== issued.length) {
    found.push("two effects share a request id");
  }
  found.push(...remoteViolations(model, issued, world));
  found.push(...moveViolations(model, issued, world));
  const listed = listedStories(model);
  if (!Bun.deepEquals(shownStories(model), listed)) {
    found.push(`the list shows ${JSON.stringify(shownStories(model).map((story) => story.id))}`);
  }
  const shown = searchedStories(model);
  const grouping = groupingOf(model.question.view);
  if (!Bun.deepEquals(shown.toSorted(orderFor(grouping)), shown)) {
    found.push(`shown stories are out of ${grouping} order`);
  }
  if (model.selectedStoryId !== null && !model.details.has(model.selectedStoryId)) {
    found.push("selected story has no detail entry");
  }
  return found;
};

const explore = (seed: number, teammates: boolean): string[] => {
  const random = mulberry32(seed);
  const world = newWorld(seed % 5 !== 0, teammates);
  const [initialModel, initEffects] = init();
  let model = initialModel;
  let issued = requestsIn(initEffects);
  const trail: string[] = [];
  const recordApplied = (answered: RemoteRequest): string[] => {
    const slot = slotOf(answered);
    if (slot === null || awaitedBy(model, answered) !== answered.requestId) return [];
    const previous = world.applied.get(slot);
    world.applied.set(slot, answered.requestId);
    return previous !== undefined && previous >= answered.requestId
      ? [`${slot} applied request ${String(answered.requestId)} after ${String(previous)}`]
      : [];
  };
  const apply = (msg: Msg, answered: RemoteRequest | null, succeeded: boolean) => {
    if (msg.type === "movePickerConfirmed") {
      const picked = pickedTarget(model);
      if (picked !== null) world.intents.set(picked[0], picked[1]);
    }
    const isResponse = answered !== null;
    if (isResponse && "requestId" in msg) world.delivered.add(msg.requestId);
    const appliesSearch =
      answered?.type === "searchStories" &&
      succeeded &&
      awaitedBy(model, answered) === answered.requestId;
    const outOfOrder = answered !== null && succeeded ? recordApplied(answered) : [];
    const before = model;
    const [next, emitted] = update(model, msg);
    const effects = requestsIn(emitted);
    model = next;
    issued = [...issued, ...effects];
    for (const effect of effects) {
      if (effect.type === "searchStories") searchSent(world, effect.requestId);
    }
    trail.push(msg.type);
    const [redelivered, redeliveryEffects] = update(model, msg);
    const redeliveryChanged =
      isResponse && (redeliveryEffects.length > 0 || !Bun.deepEquals(redelivered, model));
    if (appliesSearch) searchApplied(world, model, answered.requestId);
    const problems = [
      ...outOfOrder,
      ...conflictViolations(before, model, msg, effects),
      ...hiddenShownData(before, model),
      ...glanceViolations(before, model),
      ...violations(model, issued, world),
      ...(redeliveryChanged ? ["redelivering the same response changed the model"] : []),
    ];
    return problems.map(
      (problem) => `seed ${String(seed)} after [${trail.join(", ")}]: ${problem}`,
    );
  };

  const shortcutMovesOn = () => {
    const unread = issued.filter(
      (effect): effect is MoveEffect =>
        effect.type === "moveStory" &&
        !world.moveReads.has(effect.requestId) &&
        !world.moveAnswers.has(effect.requestId),
    );
    if (unread.length > 0 && random() < 0.5) shortcutReads(world, pick(random, unread));
    else teammateMoves(world, summary(pick(random, storyPool)).id, pick(random, teammateStates));
  };
  const deliverEverything = (): string[] => {
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
    return awaitedRequests(model).length > 0
      ? [`seed ${String(seed)}: requests still loading after every response was delivered`]
      : [];
  };
  const unsettled = (stories: readonly StorySummary[]) =>
    stories
      .filter((story) => story.state.id !== serverState(world.server, story.id).id)
      .map(
        (story) =>
          `seed ${String(seed)} settled with story ${String(story.id)} showing ${story.state.name} while the server has ${serverState(world.server, story.id).name}`,
      );

  for (let step = 0; step < stepsPerSeed; step++) {
    if (world.teammates && random() < 0.08) {
      shortcutMovesOn();
    } else if (world.teammates && random() < 0.1) {
      for (const msg of pickingMsgs(random)) {
        const problems = apply(msg, null, false);
        if (problems.length > 0) return problems;
      }
    } else if (random() < 0.55) {
      const awaited = awaitedRequests(model);
      const target = awaited.length > 0 && random() < 0.5 ? pick(random, awaited) : null;
      const effect =
        target === null
          ? pick(random, issued)
          : issued.find((candidate) => candidate.requestId === target);
      if (effect === undefined) return [`seed ${String(seed)}: awaited request never sent`];
      const succeed = random() < 0.8;
      const problems = apply(respond(random, effect, succeed, world, model), effect, succeed);
      if (problems.length > 0) return problems;
    } else {
      const problems = apply(userMsg(random, model), null, false);
      if (problems.length > 0) return problems;
    }
  }

  const undelivered = deliverEverything();
  if (undelivered.length > 0) return undelivered;
  const stale = unsettled(
    searchedStories(model).filter((story) => !world.unseenTeammateMoveAt.has(story.id)),
  );
  if (stale.length > 0) return stale;
  const refreshProblems = apply({ type: "refreshRequested" }, null, false);
  if (refreshProblems.length > 0) return refreshProblems;
  const unanswered = deliverEverything();
  return unanswered.length > 0 ? unanswered : unsettled(searchedStories(model));
};

test("random interleavings of user input, moves and reordered, duplicated responses keep the invariants", () => {
  const problems = Array.from({ length: seeds }, (_, seed) => explore(seed, false)).flat();
  expect(problems).toEqual([]);
});

test("the invariants hold while a teammate moves stories and Shortcut reads a move before it writes it", () => {
  const problems = Array.from({ length: seeds }, (_, seed) => explore(seed, true)).flat();
  expect(problems).toEqual([]);
});
