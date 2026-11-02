import { expect, test } from "bun:test";
import { detail, summary, workspaceFor } from "./fixtures.ts";
import type { Effect, Model, Msg } from "./model.ts";
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

const respond = (random: Random, effect: Effect, succeed: boolean): Msg => {
  const { requestId } = effect;
  switch (effect.type) {
    case "loadWorkspace":
      return succeed
        ? { type: "workspaceLoaded", requestId, workspace: workspaceFor("kurt") }
        : { type: "workspaceFailed", requestId, message: "workspace down" };
    case "searchStories": {
      if (!succeed) return { type: "searchFailed", requestId, message: "search down" };
      const ids = storyPool.filter(() => random() < 0.6).toSorted(() => random() - 0.5);
      const stories = ids.map((id) => summary(id, storyName(effect.query, requestId, id)));
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
  ]);

const violations = (model: Model, issued: readonly Effect[]): string[] => {
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
  ...[...model.details.values()].flatMap((remote) =>
    remote.status === "loading" ? [remote.requestId] : [],
  ),
];

const explore = (seed: number): string[] => {
  const random = mulberry32(seed);
  let [model, issued] = init();
  const trail: string[] = [];
  const apply = (msg: Msg) => {
    const [next, effects] = update(model, msg);
    model = next;
    issued = [...issued, ...effects];
    trail.push(msg.type);
    return violations(model, issued).map(
      (problem) => `seed ${String(seed)} after [${trail.join(", ")}]: ${problem}`,
    );
  };

  for (let step = 0; step < stepsPerSeed; step++) {
    const deliver = random() < 0.55;
    const msg = deliver ? respond(random, pick(random, issued), random() < 0.8) : userMsg(random);
    const problems = apply(msg);
    if (problems.length > 0) return problems;
  }

  for (let round = 0; round < 10; round++) {
    const awaited = awaitedRequests(model);
    if (awaited.length === 0) return [];
    for (const requestId of awaited) {
      const effect = issued.find((candidate) => candidate.requestId === requestId);
      if (effect === undefined) return [`seed ${String(seed)}: awaited request never sent`];
      const problems = apply(respond(random, effect, true));
      if (problems.length > 0) return problems;
    }
  }
  return [`seed ${String(seed)}: requests still loading after every response was delivered`];
};

test("random interleavings of user input and reordered, duplicated responses keep the invariants", () => {
  const problems = Array.from({ length: seeds }, (_, seed) => explore(seed)).flat();
  expect(problems).toEqual([]);
});
