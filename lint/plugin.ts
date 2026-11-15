import type { RuleTester } from "oxlint/plugins-dev";
import { noComments } from "./no-comments.ts";
import { switchOnDiscriminant } from "./switch-on-discriminant.ts";
import { opentuiTextPlacement } from "./opentui-text-placement.ts";
import { keysFromTable } from "./keys-from-table.ts";
import { paginateV4Lists } from "./paginate-v4-lists.ts";
import { classifyEveryRawEnumValue } from "./classify-every-raw-enum-value.ts";
import { boundFanOut } from "./bound-fan-out.ts";
import { parseShortcutResponses } from "./parse-shortcut-responses.ts";

export type Rule = Parameters<RuleTester["run"]>[1];

export const rules = {
  "no-comments": noComments,
  "switch-on-discriminant": switchOnDiscriminant,
  "opentui-text-placement": opentuiTextPlacement,
  "paginate-v4-lists": paginateV4Lists,
  "keys-from-table": keysFromTable,
  "classify-every-raw-enum-value": classifyEveryRawEnumValue,
  "bound-fan-out": boundFanOut,
  "parse-shortcut-responses": parseShortcutResponses,
} satisfies Record<string, Rule>;

export default {
  meta: { name: "shortcut-tui" },
  rules,
};
