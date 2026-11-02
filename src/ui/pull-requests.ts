import type { PullRequestView, Remote, StoryPullRequests } from "../app/model.ts";
import { storyMergeStatus, type StoryMergeStatus } from "../github/pull-request-state.ts";
import type { StorySummary } from "../shortcut/types.ts";
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
  draft: { glyph: "◌", label: "draft", description: "draft", color: colors.dim },
  "needs-review": {
    glyph: "○",
    label: "review",
    description: "needs review",
    color: colors.accent,
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

export const storyBadge = (
  story: StorySummary,
  pullRequests: Remote<StoryPullRequests>,
): Badge | null => {
  if (story.pullRequestCount === 0) return null;
  switch (pullRequests.status) {
    case "loading":
      return "checking";
    case "failed":
      return null;
    case "loaded": {
      const status = storyMergeStatus(
        (pullRequests.value.get(story.id) ?? []).map((pr) => pr.state),
      );
      return status === "none" ? null : status;
    }
  }
};

export const storyPullRequests = (
  story: StorySummary,
  pullRequests: Remote<StoryPullRequests>,
): Remote<readonly PullRequestView[]> | null => {
  if (story.pullRequestCount === 0) return null;
  switch (pullRequests.status) {
    case "loading":
    case "failed":
      return pullRequests;
    case "loaded":
      return { status: "loaded", value: pullRequests.value.get(story.id) ?? [] };
  }
};

export const pullRequestToOpen = (
  story: StorySummary,
  pullRequests: Remote<StoryPullRequests>,
): PullRequestView | null => {
  if (story.pullRequestCount === 0 || pullRequests.status !== "loaded") return null;
  const linked = pullRequests.value.get(story.id) ?? [];
  const deciding = storyMergeStatus(linked.map((pr) => pr.state));
  return (
    linked
      .filter((pr) => pr.state === deciding)
      .toSorted((a, b) => b.id - a.id)
      .at(0) ?? null
  );
};
