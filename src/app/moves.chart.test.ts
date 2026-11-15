import { expect, test } from "bun:test";
import type { WorkflowState } from "../shortcut/types.ts";
import { doing, summary, toDo } from "./fixtures.ts";
import type { RequestId, StoryMove } from "./model.ts";
import { moveAfterRefresh, nextMove, shownAfterRefresh, type MoveStep } from "./moves.ts";
import { firstRequestId, requestIdAfter } from "./remote.ts";

const CHART = `${import.meta.dir}/../../spec/charts/story-moves.mmd`;
const README = `${import.meta.dir}/../../README.md`;

const STATES: Record<string, WorkflowState> = { Ready: toDo, "In Progress": doing };

const stateNamed = (name: string): WorkflowState => {
  const state = STATES[name];
  if (state === undefined) throw new Error(`the chart names an unknown state: ${name}`);
  return state;
};

const nameOf = (state: WorkflowState): string => {
  const entry = Object.entries(STATES).find(([, candidate]) => candidate.id === state.id);
  if (entry === undefined) throw new Error(`no chart name for ${state.name}`);
  return entry[0];
};

type Arrow = { from: string; to: string; label: string };
type Chart = { start: string; labels: ReadonlyMap<string, string>; arrows: readonly Arrow[] };

const parseChart = (text: string): Chart => {
  const labels = new Map<string, string>();
  const arrows: Arrow[] = [];
  let start: string | null = null;
  for (const line of text.split("\n").map((raw) => raw.trim())) {
    const initial = /^\[\*\] --> (s\d+)$/.exec(line);
    const arrow = /^(s\d+) --> (s\d+): (.+)$/.exec(line);
    const node = /^(s\d+): (.+)$/.exec(line);
    if (initial?.[1] !== undefined) start = initial[1];
    else if (arrow?.[1] !== undefined && arrow[2] !== undefined && arrow[3] !== undefined) {
      arrows.push({ from: arrow[1], to: arrow[2], label: arrow[3] });
    } else if (node?.[1] !== undefined && node[2] !== undefined) labels.set(node[1], node[2]);
  }
  if (start === null) throw new Error("the chart has no start state");
  return { start, labels, arrows };
};

type Story = {
  move: StoryMove | undefined;
  shows: WorkflowState;
  server: WorkflowState;
  nextRequestId: RequestId;
};

const describeStory = ({ move, shows, server }: Story): string => {
  const shown = nameOf(shows);
  const label = ((): string => {
    switch (move?.status) {
      case undefined:
        return `Shows ${shown}`;
      case "saving": {
        const queued = move.pending === null ? "" : `, ${nameOf(move.pending)} queued`;
        return `Shows ${shown}, saving ${nameOf(move.target)}${queued}`;
      }
      case "moved":
        return `Moved, shows ${shown}`;
      case "failed":
        return `Move failed, shows ${shown}`;
    }
  })();
  const differs = move?.status !== "saving" && shows.id !== server.id;
  return differs ? `${label} (Shortcut has ${nameOf(server)})` : label;
};

const after = (story: Story, step: MoveStep | null, server = story.server): Story => {
  if (step === null) throw new Error(`the code ignores this step from "${describeStory(story)}"`);
  switch (step.kind) {
    case "hold":
      return { ...story, move: step.move, shows: step.shows, server };
    case "send":
      return {
        move: step.move,
        shows: step.move.target,
        server,
        nextRequestId: requestIdAfter(story.nextRequestId),
      };
  }
};

const saving = (story: Story) => {
  if (story.move?.status !== "saving") {
    throw new Error(`no move is saving in "${describeStory(story)}"`);
  }
  return story.move;
};

type Took = { story: Story; label: string };

const pick = (story: Story, name: string): Took => {
  const step = nextMove(
    story.move,
    { type: "picked", target: stateNamed(name), shown: story.shows },
    story.nextRequestId,
  );
  const busy = story.move?.status === "saving" ? " [while a move saves]" : "";
  return { story: after(story, step), label: `you pick ${name}${busy}` };
};

const answer = (story: Story, verdict: "confirms" | "refuses"): Took => {
  const move = saving(story);
  const step = nextMove(
    move,
    verdict === "confirms"
      ? { type: "confirmed", requestId: move.requestId, state: move.target, movedAt: new Date(0) }
      : { type: "refused", requestId: move.requestId, message: "refused" },
    story.nextRequestId,
  );
  const sent = step?.kind === "send" ? ", the queued pick is sent" : "";
  const server = verdict === "confirms" ? move.target : story.server;
  return {
    story: after(story, step, server),
    label: `Shortcut ${verdict} the move to ${nameOf(move.target)}${sent}`,
  };
};

const refreshReturns = (story: Story): Took => {
  const requestId = story.nextRequestId;
  const fresh = { ...summary(1), state: story.server };
  const move = story.move && (moveAfterRefresh(story.move, requestId, story.server) ?? undefined);
  const shows = story.move ? shownAfterRefresh(story.move, requestId, fresh).state : story.server;
  return {
    story: { ...story, move, shows, nextRequestId: requestIdAfter(requestId) },
    label: "the refresh returns",
  };
};

const take = (story: Story, label: string): Took => {
  const picked = /^you pick (.+?)(?: \[while a move saves\])?$/.exec(label);
  if (picked?.[1] !== undefined) return pick(story, picked[1]);
  if (label.startsWith("Shortcut confirms")) return answer(story, "confirms");
  if (label.startsWith("Shortcut refuses")) return answer(story, "refuses");
  if (label === "the refresh returns") return refreshReturns(story);
  throw new Error(`the test cannot replay the chart step "${label}"`);
};

const responses = (story: Story): readonly Took[] => {
  const refreshed = refreshReturns(story);
  const visible = describeStory(refreshed.story) === describeStory(story) ? [] : [refreshed];
  return story.move?.status === "saving"
    ? [answer(story, "confirms"), answer(story, "refuses"), ...visible]
    : visible;
};

const chartText = await Bun.file(CHART).text();
const chart = parseChart(chartText);

const walk = (): ReadonlyMap<string, Story> => {
  const reached = new Map<string, Story>([
    [
      chart.start,
      { move: undefined, shows: toDo, server: toDo, nextRequestId: requestIdAfter(firstRequestId) },
    ],
  ]);
  const queue = [chart.start];
  for (let node = queue.shift(); node !== undefined; node = queue.shift()) {
    const story = reached.get(node);
    if (story === undefined) continue;
    for (const arrow of chart.arrows.filter((candidate) => candidate.from === node)) {
      if (reached.has(arrow.to)) continue;
      reached.set(arrow.to, take(story, arrow.label).story);
      queue.push(arrow.to);
    }
  }
  return reached;
};

const reached = walk();

const storyAt = (node: string): Story => {
  const story = reached.get(node);
  if (story === undefined) throw new Error(`the chart state ${node} cannot be reached`);
  return story;
};

test("the chart of the move protocol was drawn from the spec with its states named", () => {
  expect(chart.labels.size).toBe(9);
  expect(chart.arrows).toHaveLength(15);
  expect([...reached.keys()].toSorted()).toEqual([...chart.labels.keys()].toSorted());
});

test.each(chart.arrows.map((arrow) => [`${arrow.from} --> ${arrow.to}: ${arrow.label}`, arrow]))(
  "the code takes the chart's arrow %s",
  (_, arrow) => {
    const from = storyAt(arrow.from);
    expect(describeStory(from)).toBe(chart.labels.get(arrow.from) ?? "");
    const took = take(from, arrow.label);
    expect(took.label).toBe(arrow.label);
    expect(describeStory(took.story)).toBe(chart.labels.get(arrow.to) ?? "");
  },
);

test("every response the code reacts to in a chart state is an arrow in the chart", () => {
  for (const [node, story] of reached) {
    const drawn = chart.arrows
      .filter((arrow) => arrow.from === node && !arrow.label.startsWith("you pick"))
      .map((arrow) => `${arrow.label} -> ${chart.labels.get(arrow.to) ?? arrow.to}`);
    const taken = responses(story).map((took) => `${took.label} -> ${describeStory(took.story)}`);
    expect({ node, arrows: taken.toSorted() }).toEqual({ node, arrows: drawn.toSorted() });
  }
});

test("the README shows the chart the code is checked against", async () => {
  const readme = await Bun.file(README).text();
  expect(readme).toContain(`\`\`\`mermaid\n${chartText.trimEnd()}\n\`\`\``);
});
