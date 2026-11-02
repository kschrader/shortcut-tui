import type { Rule } from "./plugin.ts";

type Node = { type: string; range?: unknown; [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value;

const discriminantOwner = (node: unknown): Node | null =>
  isNode(node) &&
  node.type === "MemberExpression" &&
  isNode(node["property"]) &&
  node["property"]["name"] === "type" &&
  isNode(node["object"])
    ? node["object"]
    : null;

const isStringLiteral = (node: unknown) =>
  isNode(node) && node.type === "Literal" && typeof node["value"] === "string";

const comparedDiscriminantOwner = (test: Node): Node | null => {
  if (test.type !== "BinaryExpression") return null;
  if (test["operator"] !== "===" && test["operator"] !== "!==") return null;
  if (isStringLiteral(test["right"])) return discriminantOwner(test["left"]);
  if (isStringLiteral(test["left"])) return discriminantOwner(test["right"]);
  return null;
};

const rangeOf = (node: Node) => {
  const range = node.range;
  return Array.isArray(range) && typeof range[0] === "number" && typeof range[1] === "number"
    ? ([range[0], range[1]] as const)
    : null;
};

export const switchOnDiscriminant: Rule = {
  meta: {
    type: "problem",
    messages: {
      useSwitch:
        "This function branches on `{{owner}}.type` more than once. Use a switch so switch-exhaustiveness-check catches new variants; an if chain silently routes a new variant into its last branch.",
    },
    schema: [],
  },
  create(context) {
    const scopes: Map<string, (readonly [number, number])[]>[] = [
      new Map<string, (readonly [number, number])[]>(),
    ];
    const record = (test: unknown) => {
      if (!isNode(test)) return;
      const owner = comparedDiscriminantOwner(test);
      const scope = scopes.at(-1);
      const ownerRange = owner === null ? null : rangeOf(owner);
      const testRange = rangeOf(test);
      if (ownerRange === null || testRange === null || scope === undefined) return;
      const ownerText = context.sourceCode.text.slice(ownerRange[0], ownerRange[1]);
      scope.set(ownerText, [...(scope.get(ownerText) ?? []), testRange]);
    };
    const enterFunction = () => {
      scopes.push(new Map<string, (readonly [number, number])[]>());
    };
    const exitFunction = () => {
      const scope = scopes.pop();
      for (const [owner, tests] of scope ?? []) {
        if (tests.length < 2) continue;
        for (const [start, end] of tests) {
          context.report({
            loc: {
              start: context.sourceCode.getLocFromIndex(start),
              end: context.sourceCode.getLocFromIndex(end),
            },
            messageId: "useSwitch",
            data: { owner },
          });
        }
      }
    };
    return {
      IfStatement: (node) => record(node.test),
      ConditionalExpression: (node) => record(node.test),
      FunctionDeclaration: enterFunction,
      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,
      "FunctionDeclaration:exit": exitFunction,
      "FunctionExpression:exit": exitFunction,
      "ArrowFunctionExpression:exit": exitFunction,
      "Program:exit": exitFunction,
    };
  },
};
