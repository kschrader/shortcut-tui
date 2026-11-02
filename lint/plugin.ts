import type { RuleTester } from "oxlint/plugins-dev";
import { noComments } from "./no-comments.ts";

export type Rule = Parameters<RuleTester["run"]>[1];

export const rules = {
  "no-comments": noComments,
} satisfies Record<string, Rule>;

export default {
  meta: { name: "shortcut-tui" },
  rules,
};
