import {
  epicId,
  memberId,
  pullRequestId,
  storyId,
  workflowId,
  workflowStateId,
} from "./schemas.ts";
import type {
  LinkedPullRequest,
  MemberRef,
  Progress,
  ShortcutClient,
  StoryComment,
  StoryDetail,
  StorySummary,
  StoryType,
  WorkflowState,
  Workspace,
} from "./types.ts";

export type FakeOptions = {
  delayMs?: number;
  moveDelayMs?: number;
  failMove?: (story: StorySummary, target: WorkflowState) => string | null;
  teammateMovesOnRefresh?: boolean;
};

const TEAMMATE_MOVES = storyId.parse(1001);

const member = (id: string, name: string): MemberRef => ({ id: memberId.parse(id), name });

const me = member("00000000-0000-4000-8000-000000000001", "Demo User");
const alex = member("00000000-0000-4000-8000-000000000002", "Alex Rivera");
const priya = member("00000000-0000-4000-8000-000000000003", "Priya Shah");
const sam = member("00000000-0000-4000-8000-000000000004", "Sam Okafor");

const engineering = { id: workflowId.parse(500000100), name: "Engineering" };

const state = (id: number, name: string, progress: Progress, position: number): WorkflowState => ({
  id: workflowStateId.parse(id),
  name,
  progress,
  position,
  workflow: engineering,
});

const backlog = state(500000001, "Backlog", "unstarted", 0);
const ready = state(500000002, "Ready for Development", "unstarted", 1);
const inProgress = state(500000003, "In Progress", "started", 2);
const inReview = state(500000004, "In Review", "started", 3);
const done = state(500000005, "Done", "done", 4);

export const DEMO_WORKFLOW_STATES: readonly WorkflowState[] = [
  backlog,
  ready,
  inProgress,
  inReview,
  done,
];

const workspace: Workspace = {
  me: { ...me, mentionName: "demo" },
  slug: "demo",
  canWrite: true,
  workflowStates: DEMO_WORKFLOW_STATES,
};

const epics = {
  shortcuts: { id: epicId.parse(90), name: "Keyboard-first navigation" },
  reporting: { id: epicId.parse(91), name: "Iteration reporting" },
};

const comment = (
  id: number,
  author: MemberRef | null,
  text: string,
  createdAt: string,
): StoryComment => ({
  id,
  author,
  text,
  createdAt: new Date(createdAt),
});

export const DEMO_REPOSITORY = { owner: "demo", repo: "app" };

const pullRequest = (
  number: number,
  title: string,
  { closed = false, draft = false } = {},
): LinkedPullRequest => ({
  id: pullRequestId.parse(700000 + number),
  title,
  url: `https://github.com/${DEMO_REPOSITORY.owner}/${DEMO_REPOSITORY.repo}/pull/${String(number)}`,
  closed,
  draft,
  github: { ...DEMO_REPOSITORY, number },
});

const mergeRequest = (iid: number, title: string, { closed = false } = {}): LinkedPullRequest => ({
  id: pullRequestId.parse(800000 + iid),
  title,
  url: `https://gitlab.com/demo/infra/-/merge_requests/${String(iid)}`,
  closed,
  draft: false,
  github: null,
});

type StorySeed = {
  id: number;
  name: string;
  storyType: StoryType;
  state: StorySummary["state"];
  estimate: number | null;
  owners: MemberRef[];
  epic?: StorySummary["epic"];
  updatedAt: string;
  description: string;
  labels: string[];
  comments: StoryComment[];
  pullRequests?: LinkedPullRequest[];
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
    pullRequests: [pullRequest(3955, "Forward the next param through the SSO callback")],
  },
  {
    id: 1002,
    name: "Add keyboard shortcuts cheat sheet",
    storyType: "feature",
    state: ready,
    estimate: 3,
    owners: [me, priya],
    epic: epics.shortcuts,
    updatedAt: "2026-10-29T11:00:00Z",
    description: "Show a modal listing every shortcut when the user presses `?`.",
    labels: ["ux"],
    comments: [
      comment(3, priya, "Design is in the Figma link on the epic.", "2026-10-29T11:00:00Z"),
    ],
    pullRequests: [pullRequest(3957, "Add a shortcuts cheat sheet overlay")],
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
    pullRequests: [pullRequest(3958, "Bump the Postgres client to 17")],
  },
  {
    id: 1004,
    name: "Export iteration report as CSV",
    storyType: "feature",
    state: inReview,
    estimate: 5,
    owners: [me],
    epic: epics.reporting,
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
    pullRequests: [
      pullRequest(3951, "Export iteration reports as CSV"),
      pullRequest(3948, "Add a date formatter for report exports", { closed: true }),
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
    pullRequests: [
      pullRequest(3964, "Wait for the notification queue to drain"),
      pullRequest(3965, "Retry the toast assertion once"),
    ],
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
    pullRequests: [pullRequest(3960, "Document webhook retries", { draft: true })],
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
    pullRequests: [
      pullRequest(3902, "Raise story card label contrast", { closed: true }),
      mergeRequest(41, "Raise label contrast in the email templates", { closed: true }),
    ],
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
    pullRequests: [mergeRequest(44, "Add the Q1 roadmap review checklist")],
  },
  {
    id: 1009,
    name: "Rate-limit integration retries per workspace",
    storyType: "feature",
    state: inReview,
    estimate: 3,
    owners: [me],
    updatedAt: "2026-11-01T18:05:00Z",
    description: "One noisy integration should not delay retries for everyone else.",
    labels: ["webhooks"],
    comments: [
      comment(8, priya, "Left a few notes on the limiter config.", "2026-11-01T18:05:00Z"),
    ],
    pullRequests: [
      pullRequest(3962, "Add a per-workspace retry limiter"),
      pullRequest(3963, "Expose retry limits in workspace settings"),
    ],
  },
  {
    id: 1010,
    name: "Paginate the iteration list",
    storyType: "feature",
    state: inReview,
    estimate: 2,
    owners: [priya],
    updatedAt: "2026-11-02T08:30:00Z",
    description: "Workspaces with years of iterations time out loading the list.",
    labels: [],
    comments: [],
  },
  {
    id: 1011,
    name: "Fix flaky label sync test",
    storyType: "chore",
    state: inReview,
    estimate: 1,
    owners: [alex, sam],
    updatedAt: "2026-11-01T16:00:00Z",
    description: "The label sync test races the webhook fixture.",
    labels: [],
    comments: [],
  },
];

const pullRequestsByStory = new Map(
  seeds.map((seed) => [storyId.parse(seed.id), seed.pullRequests ?? []]),
);

const seededStories: readonly StoryDetail[] = seeds.map((seed) => ({
  id: storyId.parse(seed.id),
  name: seed.name,
  storyType: seed.storyType,
  state: seed.state,
  estimate: seed.estimate,
  owners: seed.owners,
  epic: seed.epic ?? null,
  appUrl: `https://app.shortcut.com/demo/story/${seed.id}`,
  updatedAt: new Date(seed.updatedAt),
  pullRequestCount: seed.pullRequests?.length ?? 0,
  description: seed.description,
  labels: seed.labels,
  comments: seed.comments,
}));

const summaryOf = ({
  description: _description,
  labels: _labels,
  comments: _comments,
  ...summary
}: StoryDetail): StorySummary => summary;

const isMine = (story: StoryDetail) => story.owners.some((owner) => owner.id === me.id);

const matchesQuery = (story: StoryDetail, query: string): boolean =>
  query
    .split(/\s+/)
    .filter((term) => term !== "")
    .every((term) => {
      if (term === "owner:me" || term === `owner:${workspace.me.mentionName}`) return isMine(story);
      if (term === `!owner:${workspace.me.mentionName}`) return !isMine(story);
      if (term.startsWith("state:")) return `state:${String(story.state.id)}` === term;
      if (term === "!is:done") return story.state.progress !== "done";
      if (term === "is:started") return story.state.progress === "started";
      if (term.includes(":")) return true;
      return story.name.toLowerCase().includes(term.toLowerCase());
    });

const pause = (ms: number) => (ms > 0 ? Bun.sleep(ms) : Promise.resolve());

export const createFakeShortcutClient = ({
  delayMs = 0,
  moveDelayMs = delayMs,
  failMove = () => null,
  teammateMovesOnRefresh = false,
}: FakeOptions = {}): ShortcutClient => {
  const stories = new Map(seededStories.map((story) => [story.id, story]));
  let previousQuery: string | null = null;
  const teammateMoves = () => {
    const story = stories.get(TEAMMATE_MOVES);
    if (story === undefined || story.state.id === inReview.id) return;
    stories.set(story.id, { ...story, state: inReview, updatedAt: new Date() });
  };

  return {
    async loadWorkspace() {
      await pause(delayMs);
      return workspace;
    },

    async searchStories(query) {
      await pause(delayMs);
      if (teammateMovesOnRefresh && query === previousQuery) teammateMoves();
      previousQuery = query;
      return [...stories.values()].filter((story) => matchesQuery(story, query)).map(summaryOf);
    },

    async getStory(id) {
      await pause(delayMs);
      const story = stories.get(id);
      if (story === undefined)
        throw new Error(`Shortcut API 404 for GET /api/v4/demo/stories/${id}`);
      return story;
    },

    async listPullRequests(id) {
      await pause(delayMs);
      return pullRequestsByStory.get(id) ?? [];
    },

    async moveStory(id, stateId) {
      await pause(moveDelayMs);
      const story = stories.get(id);
      if (story === undefined)
        throw new Error(`Shortcut API 404 for PATCH /api/v4/demo/stories/${id}`);
      const target = DEMO_WORKFLOW_STATES.find((candidate) => candidate.id === stateId);
      if (target === undefined) {
        throw new Error(
          `Shortcut API 422 for PATCH /api/v4/demo/stories/${id} (invalid_workflow_state)`,
        );
      }
      const refusal = failMove(summaryOf(story), target);
      if (refusal !== null) throw new Error(refusal);
      const moved = { ...story, state: target, updatedAt: new Date() };
      stories.set(id, moved);
      return summaryOf(moved);
    },
  };
};
