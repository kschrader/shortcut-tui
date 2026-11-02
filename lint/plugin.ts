import type { RuleTester } from "oxlint/plugins-dev";
import { noComments } from "./no-comments.ts";
import { switchOnDiscriminant } from "./switch-on-discriminant.ts";

export type Rule = Parameters<RuleTester["run"]>[1];

export const rules = {
  "no-comments": noComments,
  "switch-on-discriminant": switchOnDiscriminant,
} satisfies Record<string, Rule>;

export default {
  meta: { name: "shortcut-tui" },
  rules,
};
