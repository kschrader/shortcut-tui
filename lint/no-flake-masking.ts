import type { Rule } from "./plugin.ts";
import { calleeRoot, isTestCall, type Node } from "./test-calls.ts";

const RETRY_KEYS = new Set(["retry", "repeats"]);

const keyName = (property: Node): string | null => {
  if (property.type !== "Property" || property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  return property.key.type === "Literal" ? String(property.key.value) : null;
};

export const noFlakeMasking: Rule = {
  meta: {
    type: "problem",
    messages: {
      retry:
        "Do not retry or repeat a test to get it green. A test that passes on rerun is a flake: wait on the event it depends on.",
      timeout:
        "Do not raise a test's timeout. Wait on the event the test depends on, or move slow shared setup into a beforeAll hook.",
    },
    schema: [],
  },
  create(context) {
    return {
      CallExpression(node) {
        if (calleeRoot(node.callee) === "setDefaultTimeout") {
          context.report({ node, messageId: "timeout" });
          return;
        }
        if (!isTestCall(node)) return;
        const options = node.arguments[2];
        if (options === undefined) return;
        if (options.type === "Literal" && typeof options.value === "number") {
          context.report({ node: options, messageId: "timeout" });
          return;
        }
        if (options.type !== "ObjectExpression") return;
        for (const property of options.properties) {
          const key = keyName(property);
          if (key === "timeout") context.report({ node: property, messageId: "timeout" });
          if (key !== null && RETRY_KEYS.has(key)) {
            context.report({ node: property, messageId: "retry" });
          }
        }
      },
    };
  },
};
