import type { Rule } from "./plugin.ts";

export const noComments: Rule = {
  meta: {
    type: "problem",
    messages: {
      banned:
        "Comments are banned. Rename the thing the comment explains, or encode the explanation as a test.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang") continue;
          context.report({ loc: comment.loc, messageId: "banned" });
        }
      },
    };
  },
};
