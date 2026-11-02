import { epicId, memberId, storyId, workflowStateId } from "./schemas.ts";
import type {
  Member,
  ShortcutClient,
  StoryComment,
  StoryDetail,
  StoryType,
  WorkflowState,
  WorkflowStateKind,
  Workspace,
} from "./types.ts";

export type FakeOptions = {
  delayMs?: number;
};

const member = (id: string, name: string, mentionName: string): Member => ({
  id: memberId.parse(id),
  name,
  mentionName,
});

const me = member("00000000-0000-4000-8000-000000000001", "Demo User", "demo");
const alex = member("00000000-0000-4000-8000-000000000002", "Alex Rivera", "alex");
const priya = member("00000000-0000-4000-8000-000000000003", "Priya Shah", "priya");
const sam = member("00000000-0000-4000-8000-000000000004", "Sam Okafor", "sam");

const state = (id: number, name: string, kind: WorkflowStateKind): WorkflowState => ({
  id: workflowStateId.parse(id),
  name,
  kind,
});

const backlog = state(500000001, "Backlog", "unstarted");
const ready = state(500000002, "Ready for Development", "unstarted");
const inProgress = state(500000003, "In Progress", "started");
const inReview = state(500000004, "In Review", "started");
const done = state(500000005, "Done", "done");

const comment = (
  id: number,
  author: Member | null,
  text: string,
  createdAt: string,
): StoryComment => ({
  id,
  authorId: author?.id ?? null,
  text,
  createdAt: new Date(createdAt),
});

type StorySeed = {
  id: number;
  name: string;
  storyType: StoryType;
  state: WorkflowState;
  estimate: number | null;
  owners: Member[];
  epicId?: number;
  updatedAt: string;
  description: string;
  labels: string[];
  comments: StoryComment[];
};

const seeds: StorySeed[] = [
  {
    id: 1001,
    name: "Login redirect drops the return URL",
    storyType: "bug",
    state: inProgress,
    estimate: 2,
    owners: [me],
    updatedAt: "2026-11-01T16:20:00Z",
    description:
      "After signing in, users always land on the dashboard instead of the page they came from.\n\nSteps\n1. Open a story link while signed out.\n2. Sign in.\n3. Observe the dashboard.",
    labels: ["auth", "regression"],
    comments: [
      comment(
        1,
        alex,
        "Reproduced on staging. The `next` param is stripped by the SSO callback.",
        "2026-10-30T09:12:00Z",
      ),
      comment(
        2,
        me,
        "Found it. Patching the callback to forward the param.",
        "2026-11-01T16:20:00Z",
      ),
    ],
  },
  {
    id: 1002,
    name: "Add keyboard shortcuts cheat sheet",
    storyType: "feature",
    state: ready,
    estimate: 3,
    owners: [me, priya],
    epicId: 90,
    updatedAt: "2026-10-29T11:00:00Z",
    description: "Show a modal listing every shortcut when the user presses `?`.",
    labels: ["ux"],
    comments: [
      comment(3, priya, "Design is in the Figma link on the epic.", "2026-10-29T11:00:00Z"),
    ],
  },
  {
    id: 1003,
    name: "Upgrade Postgres client to 17",
    storyType: "chore",
    state: backlog,
    estimate: null,
    owners: [me],
    updatedAt: "2026-10-20T08:00:00Z",
    description: "",
    labels: ["infra"],
    comments: [],
  },
  {
    id: 1004,
    name: "Export iteration report as CSV",
    storyType: "feature",
    state: inReview,
    estimate: 5,
    owners: [me],
    epicId: 91,
    updatedAt: "2026-11-02T08:45:00Z",
    description:
      "Managers want to pull iteration burndown data into spreadsheets.\n\nAcceptance criteria\n- Download button on the iteration page\n- Columns: story id, name, owner, state, estimate",
    labels: ["reporting", "customer-request"],
    comments: [
      comment(
        4,
        sam,
        "PR is up. Needs a second pair of eyes on the date formatting.",
        "2026-11-02T08:45:00Z",
      ),
      comment(
        5,
        null,
        "Linked pull request #3951 opened by the GitHub integration.",
        "2026-11-02T08:46:00Z",
      ),
    ],
  },
  {
    id: 1005,
    name: "Flaky notification test on CI",
    storyType: "bug",
    state: ready,
    estimate: 1,
    owners: [me, sam],
    updatedAt: "2026-10-31T13:30:00Z",
    description:
      "`notifications.spec` fails roughly one run in twenty with a timeout waiting for the toast.",
    labels: ["flaky-test"],
    comments: [],
  },
  {
    id: 1006,
    name: "Document webhook retry behavior",
    storyType: "chore",
    state: inProgress,
    estimate: 2,
    owners: [me],
    updatedAt: "2026-10-28T15:10:00Z",
    description:
      "Public docs say nothing about retries. Cover backoff, max attempts, and signature checks.",
    labels: ["docs"],
    comments: [
      comment(6, alex, "Retries use exponential backoff, five attempts.", "2026-10-28T15:10:00Z"),
    ],
  },
  {
    id: 1007,
    name: "Dark mode contrast on story cards",
    storyType: "bug",
    state: done,
    estimate: 1,
    owners: [me],
    updatedAt: "2026-10-25T10:00:00Z",
    description: "Label text on story cards fails WCAG AA in dark mode.",
    labels: ["a11y"],
    comments: [comment(7, priya, "Verified on the preview build.", "2026-10-25T10:00:00Z")],
  },
  {
    id: 1008,
    name: "Plan Q1 roadmap review",
    storyType: "chore",
    state: backlog,
    estimate: null,
    owners: [alex],
    updatedAt: "2026-10-22T09:00:00Z",
    description: "Collect inputs from each team ahead of the review.",
    labels: [],
    comments: [],
  },
];

const stories: readonly StoryDetail[] = seeds.map((seed) => ({
  id: storyId.parse(seed.id),
  name: seed.name,
  storyType: seed.storyType,
  workflowStateId: seed.state.id,
  estimate: seed.estimate,
  ownerIds: seed.owners.map((owner) => owner.id),
  epicId: seed.epicId === undefined ? null : epicId.parse(seed.epicId),
  appUrl: `https://app.shortcut.com/demo/story/${seed.id}`,
  updatedAt: new Date(seed.updatedAt),
  description: seed.description,
  labels: seed.labels,
  comments: seed.comments,
}));

const workspace: Workspace = {
  me,
  members: new Map([me, alex, priya, sam].map((m) => [m.id, m])),
  workflowStates: new Map([backlog, ready, inProgress, inReview, done].map((s) => [s.id, s])),
};

const matchesQuery = (story: StoryDetail, query: string): boolean =>
  query
    .split(/\s+/)
    .filter((term) => term !== "")
    .every((term) => {
      if (term === "owner:me") return story.ownerIds.includes(me.id);
      if (term === "!is:done")
        return workspace.workflowStates.get(story.workflowStateId)?.kind !== "done";
      if (term.includes(":")) return true;
      return story.name.toLowerCase().includes(term.toLowerCase());
    });

export const createFakeShortcutClient = ({ delayMs = 0 }: FakeOptions = {}): ShortcutClient => {
  const pause = () => (delayMs > 0 ? Bun.sleep(delayMs) : Promise.resolve());

  return {
    async loadWorkspace() {
      await pause();
      return workspace;
    },

    async searchStories(query) {
      await pause();
      return stories
        .filter((story) => matchesQuery(story, query))
        .map(({ description: _d, labels: _l, comments: _c, ...summary }) => summary);
    },

    async getStory(id) {
      await pause();
      const story = stories.find((candidate) => candidate.id === id);
      if (story === undefined)
        throw new Error(`Shortcut API 404 Not Found for GET /api/v3/stories/${id}`);
      return story;
    },
  };
};
