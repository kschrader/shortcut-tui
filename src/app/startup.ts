import { defaultQueryFor, queryQuestion, sameQuestion, withoutFloor } from "./filters.ts";
import { glanceOf } from "./glance.ts";
import type {
  Cached,
  Effect,
  Model,
  Question,
  SearchResults,
  StartupList,
  StoryPullRequests,
} from "./model.ts";
import { idle, loaded } from "./remote.ts";

export const noPullRequests: Cached<StoryPullRequests> = { value: new Map(), reload: idle };

export const startupQuestion = (mentionName: string): Question =>
  withoutFloor(defaultQueryFor(mentionName));

export const cachedAt = (model: Model): Date | null =>
  model.results.status === "loaded" ? model.results.value.cachedAt : null;

export const showsCachedList = (model: Model): boolean => cachedAt(model) !== null;

export const savedForStartup = (model: Model, savedAt: Date): Effect[] => {
  if (model.workspace.status !== "loaded" || model.results.status !== "loaded") return [];
  const { mentionName } = model.workspace.value.me;
  const { question, stories } = model.results.value;
  if (!sameQuestion(question, startupQuestion(mentionName))) return [];
  return [{ type: "saveStartupList", list: { mentionName, savedAt, stories } }];
};

export const startupView = (saved: StartupList | null) => {
  const question = saved === null ? queryQuestion("") : startupQuestion(saved.mentionName);
  const stories = saved?.stories ?? [];
  return {
    question,
    results: loaded<SearchResults>({ question, stories, cachedAt: saved?.savedAt ?? null }),
    selectedStoryId: stories[0]?.id ?? null,
    seen: new Map(stories.map((story) => [story.id, glanceOf(story, noPullRequests)])),
  } satisfies Partial<Model>;
};
