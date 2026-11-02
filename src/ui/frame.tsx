import { z } from "zod";
import { testRender } from "@opentui/react/test-utils";
import type { Model, Msg, RequestId, Remote, SearchResults } from "../app/model.ts";
import type {
  EpicId,
  MemberId,
  MemberRef,
  StoryDetail,
  StoryId,
  StorySummary,
  Workspace,
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

export const workspace: Workspace = { me: { ...ada, mentionName: "ada" }, slug: "acme" };

export const ready: StorySummary["state"] = {
  id: stateId(1),
  name: "Ready",
  workflowName: "Engineering",
  progress: "unstarted",
  position: 1,
};
export const inProgress: StorySummary["state"] = {
  id: stateId(2),
  name: "In Progress",
  workflowName: "Engineering",
  progress: "started",
  position: 2,
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
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  pullRequestCount: 0,
  ...overrides,
});

export const loaded = <T,>(value: T): Remote<T> => ({ status: "loaded", value });

export const modelWith = (overrides: Partial<Model>): Model => ({
  workspace: loaded(workspace),
  query: "owner:me",
  results: loaded<SearchResults>({ query: "owner:me", stories: [] }),
  selectedStoryId: null,
  details: new Map(),
  pullRequests: loaded(new Map()),
  focus: { mode: "browsing" },
  nextRequestId: requestId(10),
  ...overrides,
});

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
};

export const browsing = (overrides: Partial<Model> = {}) =>
  modelWith({
    results: loaded({ query: "owner:me", stories }),
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

export const show = async (model: Model, options: { height?: number; width?: number } = {}) => {
  const dispatched: Msg[] = [];
  const calls = { quit: 0, opened: [] as string[] };
  const screen = await testRender(
    <App
      model={model}
      dispatch={(msg) => dispatched.push(msg)}
      quit={() => {
        calls.quit += 1;
      }}
      openUrl={(url) => calls.opened.push(url)}
    />,
    { width: options.width ?? 120, height: options.height ?? 30 },
  );
  current = screen;
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", false);
  await screen.renderOnce();
  return { screen, dispatched, calls, frame: () => screen.captureCharFrame() };
};
