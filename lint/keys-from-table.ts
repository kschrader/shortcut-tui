import type { Rule } from "./plugin.ts";

const KEY_FIELDS = new Set(["name", "sequence"]);

export const keysFromTable: Rule = {
  meta: {
    type: "problem",
    messages: {
      readsKeyDirectly:
        "Do not branch on key.{{field}} in a keyboard handler. Add the key to keyBindings in src/ui/keys.ts so the help overlay and the hint bar stay in step.",
    },
    schema: [],
  },
  create(context) {
    const handlerParams: (string | null)[] = [];
    return {
      CallExpression(node) {
        const isKeyboardHook =
          node.callee.type === "Identifier" && node.callee.name === "useKeyboard";
        const [handler] = node.arguments;
        const param =
          isKeyboardHook &&
          (handler?.type === "ArrowFunctionExpression" || handler?.type === "FunctionExpression")
            ? handler.params[0]
            : undefined;
        handlerParams.push(param?.type === "Identifier" ? param.name : null);
      },
      "CallExpression:exit"() {
        handlerParams.pop();
      },
      MemberExpression(node) {
        if (node.object.type !== "Identifier" || node.property.type !== "Identifier") return;
        if (!handlerParams.includes(node.object.name)) return;
        if (!KEY_FIELDS.has(node.property.name)) return;
        context.report({
          node,
          messageId: "readsKeyDirectly",
          data: { field: node.property.name },
        });
      },
    };
  },
};
