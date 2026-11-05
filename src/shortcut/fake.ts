import { storyId } from "./schemas.ts";
import {
  DEMO_WORKFLOW_STATES,
  inReview,
  me,
  pullRequestsByStory,
  seededStories,
  workspace,
} from "./demo-stories.ts";
import type { ShortcutClient, StoryDetail, StorySummary, WorkflowState } from "./types.ts";

export type FakeOptions = {
  delayMs?: number;
  moveDelayMs?: number;
  failMove?: (story: StorySummary, target: WorkflowState) => string | null;
  teammateMovesOnRefresh?: boolean;
};

const TEAMMATE_MOVES = storyId.parse(1001);

const summaryOf = ({
  description: _description,
  labels: _labels,
  comments: _comments,
  ...summary
}: StoryDetail): StorySummary => summary;

const isMine = (story: StoryDetail) => story.owners.some((owner) => owner.id === me.id);

const MOVED_BY = /^moved:\*\.\.(\d{4})-(\d{2})-(\d{2})$/;

const movedBy = (story: StoryDetail, term: string): boolean => {
  const day = MOVED_BY.exec(term);
  if (day === null) return true;
  const nextDay = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]) + 1);
  return story.movedAt.getTime() < nextDay.getTime();
};

const matchesQuery = (story: StoryDetail, query: string): boolean =>
  query
    .split(/\s+/)
    .filter((term) => term !== "")
    .every((term) => {
      if (term === "owner:me" || term === `owner:${workspace.me.mentionName}`) return isMine(story);
      if (term === `!owner:${workspace.me.mentionName}`) return !isMine(story);
      if (term.startsWith("moved:")) return movedBy(story, term);
      if (term.startsWith("state:")) return `state:${String(story.state.id)}` === term;
      if (term === "!is:done") return story.state.progress !== "done";
      if (term === "is:started") return story.state.progress === "started";
      if (term === "has:pr") return story.pullRequestCount > 0;
      if (term === "!has:pr") return story.pullRequestCount === 0;
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
    const now = new Date();
    stories.set(story.id, { ...story, state: inReview, updatedAt: now, movedAt: now });
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
      const now = new Date();
      const moved = { ...story, state: target, updatedAt: now, movedAt: now };
      stories.set(id, moved);
      return summaryOf(moved);
    },
  };
};
