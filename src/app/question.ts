import type { Question } from "./model.ts";

export const queryQuestion = (text: string): Question => ({ kind: "query", text });

export const sameQuestion = (a: Question, b: Question): boolean => {
  switch (a.kind) {
    case "query":
      return b.kind === "query" && a.text === b.text;
  }
};
