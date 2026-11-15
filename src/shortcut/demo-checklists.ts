import type { ChecklistItem } from "./types.ts";

const CHECKLISTS: ReadonlyMap<
  number,
  readonly (readonly [description: string, completed: boolean])[]
> = new Map([
  [
    1004,
    [
      ["Pick the report columns", true],
      ["Quote fields that contain commas", true],
      ["Add the download button", false],
      ["Try a 500-story iteration", false],
    ],
  ],
  [
    1006,
    [
      ["Describe the retry schedule", true],
      ["Explain what happens after the last retry", false],
    ],
  ],
]);

export const checklistOf = (storyId: number): ChecklistItem[] =>
  (CHECKLISTS.get(storyId) ?? []).map(([description, completed], index) => ({
    id: storyId * 100 + index,
    description,
    completed,
  }));
