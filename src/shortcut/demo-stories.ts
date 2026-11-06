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
  StoryComment,
  StoryDetail,
  StoryRef,
  StorySummary,
  StoryType,
  WorkflowState,
  Workspace,
} from "./types.ts";

const member = (id: string, name: string): MemberRef => ({ id: memberId.parse(id), name });

export const me = member("00000000-0000-4000-8000-000000000001", "Demo User");
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
export const inReview = state(500000004, "In Review", "started", 3);
const done = state(500000005, "Done", "done", 4);

export const DEMO_WORKFLOW_STATES: readonly WorkflowState[] = [
  backlog,
  ready,
  inProgress,
  inReview,
  done,
];

export const workspace: Workspace = {
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
  movedAt?: string;
  description: string;
  labels: string[];
  comments: StoryComment[];
  pullRequests?: LinkedPullRequest[];
  parentId?: number;
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
    movedAt: "2026-09-14T15:10:00Z",
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
    movedAt: "2026-10-30T14:00:00Z",
    description: "Workspaces with years of iterations time out loading the list.",
    labels: [],
    comments: [],
    pullRequests: [pullRequest(3970, "Page the iteration list by cursor")],
  },
  {
    id: 1011,
    name: "Fix flaky label sync test",
    storyType: "chore",
    state: inReview,
    estimate: 1,
    owners: [sam, priya],
    updatedAt: "2026-11-01T16:00:00Z",
    movedAt: "2026-09-25T10:00:00Z",
    description: "The label sync test races the webhook fixture.",
    labels: [],
    comments: [],
    pullRequests: [pullRequest(3971, "Wait for the webhook fixture before syncing labels")],
  },
  {
    id: 1012,
    name: "Resend failed deliveries from the dashboard",
    storyType: "feature",
    state: inProgress,
    estimate: 3,
    owners: [alex],
    updatedAt: "2026-10-03T10:00:00Z",
    movedAt: "2026-10-02T09:00:00Z",
    description: "Let workspace admins resend a delivery that failed every retry.",
    labels: ["webhooks"],
    comments: [],
    pullRequests: [pullRequest(3980, "Add a retry button to failed deliveries", { closed: true })],
  },
  {
    id: 1013,
    name: "Trim whitespace in imported story titles",
    storyType: "bug",
    state: inProgress,
    estimate: 1,
    owners: [sam],
    updatedAt: "2026-10-14T12:00:00Z",
    movedAt: "2026-10-12T16:00:00Z",
    description: "CSV imports keep trailing spaces, so titles do not match in search.",
    labels: ["import"],
    comments: [],
    pullRequests: [pullRequest(3981, "Trim titles in the CSV importer", { closed: true })],
  },
  {
    id: 1014,
    name: "Cache iteration burndown queries",
    storyType: "chore",
    state: inProgress,
    estimate: 2,
    owners: [priya],
    updatedAt: "2026-10-09T11:00:00Z",
    movedAt: "2026-10-08T11:00:00Z",
    description: "The burndown chart reruns the same query on every page load.",
    labels: ["reporting"],
    comments: [],
    pullRequests: [pullRequest(3982, "Memoize the burndown query", { closed: true })],
  },
  {
    id: 1015,
    name: "Plan the on-call rotation for next quarter",
    storyType: "chore",
    state: backlog,
    estimate: null,
    owners: [alex],
    updatedAt: "2026-10-27T09:00:00Z",
    description: "Draft the rotation and share it before the holidays.",
    labels: [],
    comments: [],
  },
];

export const pullRequestsByStory = new Map(
  seeds.map((seed) => [storyId.parse(seed.id), seed.pullRequests ?? []]),
);

export type SeededStory = Omit<StoryDetail, "subTasks">;

const appUrlOf = (id: number) => `https://app.shortcut.com/demo/story/${id}`;

const parentOf = ({ parentId }: StorySeed): StoryRef | null => {
  const parent = seeds.find((seed) => seed.id === parentId);
  return parent === undefined
    ? null
    : { id: storyId.parse(parent.id), name: parent.name, appUrl: appUrlOf(parent.id) };
};

export const seededStories: readonly SeededStory[] = seeds.map((seed) => ({
  id: storyId.parse(seed.id),
  name: seed.name,
  storyType: seed.storyType,
  state: seed.state,
  estimate: seed.estimate,
  owners: seed.owners,
  epic: seed.epic ?? null,
  appUrl: appUrlOf(seed.id),
  updatedAt: new Date(seed.updatedAt),
  movedAt: new Date(seed.movedAt ?? seed.updatedAt),
  pullRequestCount: seed.pullRequests?.length ?? 0,
  parent: parentOf(seed),
  subTaskCount: seeds.filter((other) => other.parentId === seed.id).length,
  description: seed.description,
  labels: seed.labels,
  comments: seed.comments,
}));
