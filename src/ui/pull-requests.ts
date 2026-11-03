import type { Cached, PullRequestView, Settled, StoryPullRequests } from "../app/model.ts";
import { inFlight } from "../app/remote.ts";
import { storyMergeStatus, type StoryMergeStatus } from "../github/pull-request-state.ts";
import type { StorySummary } from "../shortcut/types.ts";
import { storyCount } from "./format.ts";
import { colors } from "./theme.ts";

export type Badge = Exclude<StoryMergeStatus, "none"> | "checking";

export type BadgeStyle = { glyph: string; label: string; description: string; color: string };

export const badgeStyle: Record<Badge, BadgeStyle> = {
  conflicts: {
    glyph: "≠",
    label: "conflicts",
    description: "merge conflicts",
    color: colors.error,
  },
  "checks-failing": {
    glyph: "✗",
    label: "CI failing",
    description: "checks failing",
    color: colors.error,
  },
  "changes-requested": {
    glyph: "!",
    label: "changes",
    description: "changes requested",
    color: colors.caution,
  },
  behind: {
    glyph: "↓",
    label: "behind",
    description: "needs update from base",
    color: colors.caution,
  },
  draft: { glyph: "◌", label: "draft", description: "draft", color: colors.dim },
  "needs-review": {
    glyph: "○",
    label: "review",
    description: "needs review",
    color: colors.accent,
  },
  blocked: {
    glyph: "⊟",
    label: "blocked",
    description: "blocked by branch rules",
    color: colors.caution,
  },
  "checks-running": {
    glyph: "◔",
    label: "CI running",
    description: "checks running",
    color: colors.warning,
  },
  unknown: { glyph: "?", label: "unknown", description: "status unknown", color: colors.dim },
  ready: { glyph: "✓", label: "ready", description: "ready to merge", color: colors.ok },
  merged: { glyph: "◉", label: "merged", description: "merged", color: colors.merged },
  closed: { glyph: "⊘", label: "closed", description: "closed unmerged", color: colors.dim },
  checking: { glyph: "…", label: "checking", description: "checking GitHub", color: colors.dim },
};

export const BADGE_LABEL_WIDTH = Math.max(
  ...Object.values(badgeStyle).map((style) => style.label.length),
);

export type StoryPullRequestList = { status: "checking" } | Settled<readonly PullRequestView[]>;

export const storyPullRequests = (
  story: StorySummary,
  pullRequests: Cached<StoryPullRequests>,
): StoryPullRequestList | null => {
  if (story.pullRequestCount === 0) return null;
  const list = pullRequests.value.get(story.id);
  if (list !== undefined) return list;
  const { reload } = pullRequests;
  switch (reload.status) {
    case "inFlight":
      return { status: "checking" };
    case "failed":
      return { status: "failed", message: reload.message };
    case "idle":
      return { status: "loaded", value: [] };
  }
};

export const storyBadge = (
  story: StorySummary,
  pullRequests: Cached<StoryPullRequests>,
): Badge | null => {
  if (story.pullRequestCount === 0) return null;
  const list = pullRequests.value.get(story.id);
  if (list === undefined) return inFlight(pullRequests.reload) === null ? null : "checking";
  switch (list.status) {
    case "failed":
      return "unknown";
    case "loaded": {
      const status = storyMergeStatus(list.value.map((pr) => pr.state));
      return status === "none" ? null : status;
    }
  }
};

export const pullRequestToOpen = (
  story: StorySummary,
  pullRequests: Cached<StoryPullRequests>,
): PullRequestView | null => {
  const list = storyPullRequests(story, pullRequests);
  if (list?.status !== "loaded") return null;
  const linked = list.value;
  const deciding = storyMergeStatus(linked.map((pr) => pr.state));
  return (
    linked
      .filter((pr) => pr.state === deciding)
      .toSorted((a, b) => b.id - a.id)
      .at(0) ?? null
  );
};

export const pullRequestTrouble = (pullRequests: Cached<StoryPullRequests>): string | null => {
  const { reload } = pullRequests;
  if (reload.status === "failed") return `PR status: ${reload.message}`;
  const failures = [...pullRequests.value.values()].flatMap((list) =>
    list.status === "failed" ? [list.message] : [],
  );
  const [first] = failures;
  return first === undefined ? null : `PR status for ${storyCount(failures.length)}: ${first}`;
};
