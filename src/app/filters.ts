import type { Workspace } from "../shortcut/types.ts";
import type { Question } from "./model.ts";

export type Grouping = "state" | "owner";

export type Filter = {
  id: "mine" | "inReview";
  label: string;
  questionFor: (workspace: Workspace) => Question;
};

export const queryQuestion = (text: string): Question => ({ kind: "query", text });

const inReview: Question = { kind: "inReview" };

export const defaultQueryFor = (mentionName: string): Question =>
  queryQuestion(`owner:${mentionName} is:started !is:archived`);

const reviewLabel = "waiting for review · team";

export const filters: readonly [Filter, ...Filter[]] = [
  {
    id: "mine",
    label: "my started stories",
    questionFor: (workspace) => defaultQueryFor(workspace.me.mentionName),
  },
  { id: "inReview", label: reviewLabel, questionFor: () => inReview },
];

export const sameQuestion = (a: Question, b: Question): boolean => {
  switch (a.kind) {
    case "query":
      return b.kind === "query" && a.text === b.text;
    case "inReview":
      return b.kind === "inReview";
  }
};

const asks = (question: Question, workspace: Workspace) => (filter: Filter) =>
  sameQuestion(filter.questionFor(workspace), question);

const filterShowing = (question: Question, workspace: Workspace): Filter | undefined =>
  filters.find(asks(question, workspace));

export const filterAfter = (question: Question, workspace: Workspace): Filter => {
  const current = filters.findIndex(asks(question, workspace));
  return filters[(current + 1) % filters.length] ?? filters[0];
};

const REVIEW_STATE = /review/i;

export const queriesFor = (question: Question, workspace: Workspace): readonly string[] => {
  switch (question.kind) {
    case "query":
      return [question.text];
    case "inReview":
      return workspace.workflowStates
        .filter((state) => REVIEW_STATE.test(state.name))
        .map(
          (state) => `state:${String(state.id)} !owner:${workspace.me.mentionName} !is:archived`,
        );
  }
};

export const groupingOf = (question: Question): Grouping => {
  switch (question.kind) {
    case "query":
      return "state";
    case "inReview":
      return "owner";
  }
};

export const isReviewView = (question: Question): boolean => {
  switch (question.kind) {
    case "query":
      return false;
    case "inReview":
      return true;
  }
};

export const draftFor = (question: Question): string => {
  switch (question.kind) {
    case "query":
      return question.text === "" ? "" : `${question.text} `;
    case "inReview":
      return "";
  }
};

export const questionLabel = (question: Question, workspace: Workspace): string => {
  switch (question.kind) {
    case "inReview":
      return reviewLabel;
    case "query":
      return (
        filterShowing(question, workspace)?.label ??
        (question.text === "" ? "all stories" : question.text)
      );
  }
};
