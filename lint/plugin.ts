import type { RuleTester } from "oxlint/plugins-dev";
import { noComments } from "./no-comments.ts";
import { switchOnDiscriminant } from "./switch-on-discriminant.ts";
import { opentuiTextPlacement } from "./opentui-text-placement.ts";

export type Rule = Parameters<RuleTester["run"]>[1];

export const rules = {
  "no-comments": noComments,
  "switch-on-discriminant": switchOnDiscriminant,
  "opentui-text-placement": opentuiTextPlacement,
} satisfies Record<string, Rule>;

export default {
  meta: { name: "shortcut-tui" },
  rules,
};
