import { blockingOf } from "./demo-blocks.ts";
import { seeds, type StorySeed } from "./demo-seeds.ts";
import { storyId } from "./schemas.ts";
import type { StoryDetail, StoryRef } from "./types.ts";

export const pullRequestsByStory = new Map(
  seeds.map((seed) => [storyId.parse(seed.id), seed.pullRequests ?? []]),
);

export type SeededStory = Omit<StoryDetail, "subTasks">;

const appUrlOf = (id: number) => `https://app.shortcut.com/demo/story/${id}`;

const branchNameOf = ({ id, name }: StorySeed): string =>
  `demo/sc-${id}/${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;

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
  branchName: branchNameOf(seed),
  updatedAt: new Date(seed.updatedAt),
  movedAt: new Date(seed.movedAt ?? seed.updatedAt),
  pullRequestCount: seed.pullRequests?.length ?? 0,
  parent: parentOf(seed),
  subTaskCount: seeds.filter((other) => other.parentId === seed.id).length,
  ...blockingOf(seed.id),
  description: seed.description,
  labels: seed.labels,
  comments: seed.comments,
}));
