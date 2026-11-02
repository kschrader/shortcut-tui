import type { Rule } from "./plugin.ts";

type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type JsxElement = Parameters<NonNullable<Visitor["JSXElement"]>>[0];
type JsxChild = JsxElement["children"][number];

const TEXT_MODIFIERS = new Set(["span", "strong", "em", "u", "b", "i", "br", "a"]);
const TEXT_HOSTS = new Set(["text", "code", "input", "textarea"]);
const CONTAINERS = new Set(["box", "scrollbox", "group"]);
const STRUCTURAL_EXPRESSIONS = new Set([
  "JSXEmptyExpression",
  "JSXElement",
  "JSXFragment",
  "ConditionalExpression",
  "LogicalExpression",
  "CallExpression",
]);

const tagName = (node: JsxElement): string | null =>
  node.openingElement.name.type === "JSXIdentifier" ? node.openingElement.name.name : null;

const isBareText = (child: JsxChild): boolean =>
  child.type === "JSXText"
    ? child.value.trim() !== ""
    : child.type === "JSXExpressionContainer" && !STRUCTURAL_EXPRESSIONS.has(child.expression.type);

export const opentuiTextPlacement: Rule = {
  meta: {
    type: "problem",
    messages: {
      bareText: "Text must live inside <text>. Wrap it: <text>...</text>.",
      modifierOutsideText: "<{{tag}}> only works inside <text>.",
    },
    schema: [],
  },
  create(context) {
    const open: (string | null)[] = [];
    return {
      JSXElement(node) {
        const tag = tagName(node);
        const insideText = open.some((name) => name !== null && TEXT_HOSTS.has(name));
        if (tag !== null && TEXT_MODIFIERS.has(tag) && !insideText) {
          context.report({ node, messageId: "modifierOutsideText", data: { tag } });
        }
        if (tag !== null && CONTAINERS.has(tag)) {
          for (const child of node.children) {
            if (isBareText(child)) context.report({ node: child, messageId: "bareText" });
          }
        }
        open.push(tag);
      },
      "JSXElement:exit"() {
        open.pop();
      },
    };
  },
};
