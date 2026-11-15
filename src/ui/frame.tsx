import { z } from "zod";
import { testRender } from "@opentui/react/test-utils";
import { useEffect, useState } from "react";
import type {
  Cached,
  Model,
  Msg,
  Reload,
  Remote,
  RequestId,
  SearchResults,
  Settled,
} from "../app/model.ts";
import { queryQuestion } from "../app/filters.ts";
import { glanceOf } from "../app/glance.ts";
import { createFakeClock } from "../app/fake-clock.ts";
import { idle } from "../app/remote.ts";
import { useStoryBrowser } from "../app/runtime.ts";
import { createFakeGitHubClient } from "../github/fake.ts";
import { createFakeShortcutClient } from "../shortcut/fake.ts";
import type {
  EpicId,
  MemberId,
  MemberRef,
  StoryDetail,
  StoryId,
  StorySummary,
  Workspace,
  WorkflowId,
  WorkflowState,
  WorkflowStateId,
} from "../shortcut/types.ts";
import { App } from "./App.tsx";

export const memberId = (id: string) => z.custom<MemberId>().parse(id);
export const stateId = (id: number) => z.custom<WorkflowStateId>().parse(id);
export const storyId = (id: number) => z.custom<StoryId>().parse(id);
export const requestId = (id: number) => z.custom<RequestId>().parse(id);
export const epicId = (id: number) => z.custom<EpicId>().parse(id);

export const ada: MemberRef = { id: memberId("ada"), name: "Ada Lovelace" };
export const grace: MemberRef = { id: memberId("grace"), name: "Grace Hopper" };

export const engineering = { id: z.custom<WorkflowId>().parse(1), name: "Engineering" };

export const ready: WorkflowState = {
  id: stateId(1),
  name: "Ready",
  progress: "unstarted",
  position: 1,
  workflow: engineering,
};
export const inProgress: WorkflowState = {
  id: stateId(2),
  name: "In Progress",
  progress: "started",
  position: 2,
  workflow: engineering,
};
export const done: WorkflowState = {
  id: stateId(3),
  name: "Done",
  progress: "done",
  position: 3,
  workflow: engineering,
};

export const workspace: Workspace = {
  me: { ...ada, mentionName: "ada" },
  slug: "acme",
  canWrite: true,
  workflowStates: [ready, inProgress, done],
};

export const summary = (id: number, overrides: Partial<StorySummary> = {}): StorySummary => ({
  id: storyId(id),
  name: `Story number ${id}`,
  storyType: "feature",
  state: ready,
  estimate: 3,
  owners: [ada],
  epic: null,
  appUrl: `https://app.shortcut.com/acme/story/${id}`,
  branchName: `ada/sc-${id}/story-number-${id}`,
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  movedAt: new Date("2026-10-01T00:00:00Z"),
  pullRequestCount: 0,
  parent: null,
  subTaskCount: 0,
  blocked: false,
  blocker: false,
  ...overrides,
});

export const loaded = <T,>(
  value: T,
  reload: Reload = idle,
): Extract<Remote<T>, { status: "loaded" }> => ({
  status: "loaded",
  value,
  reload,
});

export const settled = <T,>(value: T): Settled<T> => ({ status: "loaded", value });

export const cached = <T,>(value: T, reload: Reload = idle): Cached<T> => ({ value, reload });

export const reloading = (id: RequestId): Reload => ({ status: "inFlight", requestId: id });

export const reloadFailed = (message: string): Reload => ({ status: "failed", message });

const seenAsShown = (model: Model): Model["seen"] =>
  new Map(
    model.results.status === "loaded"
      ? model.results.value.stories.map((story) => [story.id, glanceOf(story, model.pullRequests)])
      : [],
  );

const defaultsWith = (overrides: Partial<Model>): Model => ({
  workspace: loaded(workspace),
  question: queryQuestion("owner:me"),
  results: loaded<SearchResults>({ question: queryQuestion("owner:me"), stories: [] }),
  loadedAt: null,
  selectedStoryId: null,
  details: new Map(),
  pullRequests: cached(new Map()),
  moves: new Map(),
  seen: new Map(),
  focus: { mode: "browsing" },
  nextRequestId: requestId(10),
  ...overrides,
});

export const modelWith = (overrides: Partial<Model>): Model => {
  const model = defaultsWith(overrides);
  return overrides.seen === undefined ? { ...model, seen: seenAsShown(model) } : model;
};

export const stories = [
  summary(101, { name: "Fix login redirect", storyType: "bug", state: inProgress }),
  summary(102, {
    name: "Add dark mode",
    owners: [ada, grace],
    epic: { id: epicId(7), name: "Theming" },
  }),
  summary(103, { name: "Rotate API keys", storyType: "chore", estimate: null }),
];

export const detail: StoryDetail = {
  ...stories[1],
  description: "Users want a dark theme.",
  labels: ["design", "frontend"],
  comments: [
    {
      id: 1,
      author: grace,
      text: "Let us ship it behind a flag.",
      createdAt: new Date("2026-10-05T12:00:00Z"),
    },
    {
      id: 2,
      author: null,
      text: "Linked a pull request.",
      createdAt: new Date("2026-10-06T12:00:00Z"),
    },
  ],
  subTasks: [],
  checklist: [],
};

export const browsing = (overrides: Partial<Model> = {}) =>
  modelWith({
    results: loaded({ question: queryQuestion("owner:me"), stories }),
    selectedStoryId: stories[1].id,
    details: new Map([[detail.id, loaded(detail)]]),
    ...overrides,
  });

export type Rendered = Awaited<ReturnType<typeof testRender>>;
let current: Rendered | null = null;

export const cleanup = () => {
  current?.renderer.destroy();
  current = null;
};

export const show = async (
  model: Model,
  options: { height?: number; width?: number; now?: Date; clipboard?: "works" | "missing" } = {},
) => {
  const dispatched: Msg[] = [];
  const calls = { quit: 0, opened: [] as string[], copied: [] as string[] };
  const shownModel: { replace?: (next: Model) => void } = {};
  const Harness = () => {
    const [shown, setShown] = useState(model);
    useEffect(() => {
      shownModel.replace = setShown;
    }, []);
    return (
      <App
        model={shown}
        now={options.now ?? new Date("2026-11-02T09:00:00Z")}
        dispatch={(msg) => dispatched.push(msg)}
        quit={() => {
          calls.quit += 1;
        }}
        openUrl={(url) => calls.opened.push(url)}
        copyText={(text) => {
          if (options.clipboard === "missing") return false;
          calls.copied.push(text);
          return true;
        }}
      />
    );
  };
  const screen = await testRender(<Harness />, {
    width: options.width ?? 120,
    height: options.height ?? 30,
  });
  current = screen;
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  await screen.renderOnce();
  const rerender = async (next: Model) => {
    shownModel.replace?.(next);
    await screen.renderOnce();
  };
  return { screen, dispatched, calls, rerender, frame: () => screen.captureCharFrame() };
};

export const launchDemo = async ({ width = 80, height = 24 } = {}) => {
  const clock = createFakeClock(new Date("2026-11-02T09:00:00Z"));
  const clients = {
    shortcut: createFakeShortcutClient({ teammateMovesOnRefresh: true }),
    github: createFakeGitHubClient(),
  };
  const Root = () => {
    const { model, dispatch, now } = useStoryBrowser(clients, {
      clock,
      autoRefresh: { mode: "off" },
    });
    return (
      <App
        model={model}
        now={now}
        dispatch={dispatch}
        quit={() => {}}
        openUrl={() => {}}
        copyText={() => true}
      />
    );
  };
  const screen = await testRender(<Root />, { width, height });
  current = screen;
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  const frame = () => screen.captureCharFrame();
  const until = async (reached: () => boolean) => {
    for (let turn = 0; turn < 100 && !reached(); turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      await screen.renderOnce();
    }
    if (!reached()) throw new Error(`the demo never got there:\n${frame()}`);
  };
  const press = async (key: string) => {
    screen.mockInput.pressKey(key);
    await screen.renderOnce();
  };
  await until(() => frame().includes("Login redirect drops the return"));
  return { screen, frame, until, press };
};
