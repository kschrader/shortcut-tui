import type { Workspace } from "../shortcut/types.ts";
import type { CalendarDay, Question, View } from "./model.ts";

export type Grouping = "state" | "owner";

export type Filter = {
  id: "mine" | "inReview" | "mergedNotMoved";
  label: string;
  viewFor: (workspace: Workspace) => View;
};

export const queryView = (text: string): View => ({ kind: "query", text });

export const withoutFloor = (view: View): Question => ({ view, movedOnOrBefore: null });

export const queryQuestion = (text: string): Question => withoutFloor(queryView(text));

const inReview: View = { kind: "inReview" };

const mergedNotMoved: View = { kind: "mergedNotMoved" };

export const defaultQueryFor = (mentionName: string): View =>
  queryView(`owner:${mentionName} is:started !is:archived`);

const reviewLabel = "waiting for review · team";

const mergedLabel = "merged, not moved · team";

export const filters: readonly [Filter, ...Filter[]] = [
  {
    id: "mine",
    label: "my started stories",
    viewFor: (workspace) => defaultQueryFor(workspace.me.mentionName),
  },
  { id: "inReview", label: reviewLabel, viewFor: () => inReview },
  { id: "mergedNotMoved", label: mergedLabel, viewFor: () => mergedNotMoved },
];

export const AGE_FLOOR_WEEKS = 4;

export const AGE_FLOOR_LABEL = `${String(AGE_FLOOR_WEEKS)}w+`;

const isCalendarDay = (text: string): text is CalendarDay => /^\d{4}-\d{2}-\d{2}$/.test(text);

const twoDigits = (n: number) => String(n).padStart(2, "0");

export const ageFloorFrom = (at: Date): CalendarDay => {
  const day = new Date(at.getFullYear(), at.getMonth(), at.getDate() - 7 * AGE_FLOOR_WEEKS);
  const year = String(day.getFullYear()).padStart(4, "0");
  const text = `${year}-${twoDigits(day.getMonth() + 1)}-${twoDigits(day.getDate())}`;
  if (!isCalendarDay(text)) throw new RangeError(`no calendar day ${text} for ${String(at)}`);
  return text;
};

const sameView = (a: View, b: View): boolean => {
  switch (a.kind) {
    case "query":
      return b.kind === "query" && a.text === b.text;
    case "inReview":
    case "mergedNotMoved":
      return b.kind === a.kind;
  }
};

export const sameQuestion = (a: Question, b: Question): boolean =>
  sameView(a.view, b.view) && a.movedOnOrBefore === b.movedOnOrBefore;

const shows = (view: View, workspace: Workspace) => (filter: Filter) =>
  sameView(filter.viewFor(workspace), view);

const filterShowing = (view: View, workspace: Workspace): Filter | undefined =>
  filters.find(shows(view, workspace));

export const filterAfter = (view: View, workspace: Workspace): Filter => {
  const current = filters.findIndex(shows(view, workspace));
  return filters[(current + 1) % filters.length] ?? filters[0];
};

const REVIEW_STATE = /review/i;

const viewQueries = (view: View, workspace: Workspace): readonly string[] => {
  switch (view.kind) {
    case "query":
      return [view.text];
    case "inReview":
      return workspace.workflowStates
        .filter((state) => REVIEW_STATE.test(state.name))
        .map(
          (state) => `state:${String(state.id)} !owner:${workspace.me.mentionName} !is:archived`,
        );
    case "mergedNotMoved":
      return ["is:started !is:archived has:pr"];
  }
};

export const queriesFor = (question: Question, workspace: Workspace): readonly string[] => {
  const queries = viewQueries(question.view, workspace);
  const floor = question.movedOnOrBefore;
  if (floor === null) return queries;
  const clause = `moved:*..${floor}`;
  return queries.map((query) => (query === "" ? clause : `${query} ${clause}`));
};

export const groupingOf = (view: View): Grouping => {
  switch (view.kind) {
    case "query":
      return "state";
    case "inReview":
    case "mergedNotMoved":
      return "owner";
  }
};

export const isReviewView = (view: View): boolean => {
  switch (view.kind) {
    case "query":
    case "mergedNotMoved":
      return false;
    case "inReview":
      return true;
  }
};

export const showsOnlyMerged = (view: View): boolean => {
  switch (view.kind) {
    case "query":
    case "inReview":
      return false;
    case "mergedNotMoved":
      return true;
  }
};

export const draftFor = (view: View): string => {
  switch (view.kind) {
    case "query":
      return view.text === "" ? "" : `${view.text} `;
    case "inReview":
    case "mergedNotMoved":
      return "";
  }
};

export const viewLabel = (view: View, workspace: Workspace): string => {
  switch (view.kind) {
    case "inReview":
      return reviewLabel;
    case "mergedNotMoved":
      return mergedLabel;
    case "query":
      return (
        filterShowing(view, workspace)?.label ?? (view.text === "" ? "all stories" : view.text)
      );
  }
};
