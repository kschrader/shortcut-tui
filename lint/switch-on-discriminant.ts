import type { Rule } from "./plugin.ts";

type Node = { type: string; range?: unknown; [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && "type" in value;

const discriminantAccess = (node: unknown): Node | null =>
  isNode(node) &&
  node.type === "MemberExpression" &&
  node["computed"] !== true &&
  isNode(node["property"]) &&
  node["property"].type === "Identifier"
    ? node
    : null;

const isStringLiteral = (node: unknown) =>
  isNode(node) && node.type === "Literal" && typeof node["value"] === "string";

const comparedDiscriminantOwner = (test: Node): Node | null => {
  if (test.type !== "BinaryExpression") return null;
  if (test["operator"] !== "===" && test["operator"] !== "!==") return null;
  if (isStringLiteral(test["right"])) return discriminantAccess(test["left"]);
  if (isStringLiteral(test["left"])) return discriminantAccess(test["right"]);
  return null;
};

const rangeOf = (node: Node) => {
  const range = node.range;
  return Array.isArray(range) && typeof range[0] === "number" && typeof range[1] === "number"
    ? ([range[0], range[1]] as const)
    : null;
};

const chainContainer = (branch: Node): Node | null => {
  let parent: unknown = branch["parent"];
  while (
    isNode(parent) &&
    (parent.type === "IfStatement" || parent.type === "ConditionalExpression")
  ) {
    parent = parent["parent"];
  }
  return isNode(parent) ? parent : null;
};

const EXIT_STATEMENTS = new Set([
  "ReturnStatement",
  "ThrowStatement",
  "ContinueStatement",
  "BreakStatement",
]);

const alwaysExits = (statement: unknown): boolean => {
  if (!isNode(statement)) return false;
  if (EXIT_STATEMENTS.has(statement.type)) return true;
  const body = statement["body"];
  return statement.type === "BlockStatement" && Array.isArray(body) && alwaysExits(body.at(-1));
};

const dispatches = (branch: Node) =>
  branch.type === "ConditionalExpression" ||
  isNode(branch["alternate"]) ||
  (isNode(branch["parent"]) && branch["parent"].type === "IfStatement") ||
  alwaysExits(branch["consequent"]);

export const switchOnDiscriminant: Rule = {
  meta: {
    type: "problem",
    messages: {
      useSwitch:
        "These branches test `{{owner}}` more than once. Use a switch so switch-exhaustiveness-check catches new variants; an if chain silently routes a new variant into its last branch.",
    },
    schema: [],
  },
  create(context) {
    const testsByChain = new Map<string, (readonly [number, number])[]>();
    const record = (branch: unknown) => {
      if (!isNode(branch) || !isNode(branch["test"]) || !dispatches(branch)) return;
      const test = branch["test"];
      const access = comparedDiscriminantOwner(test);
      const container = chainContainer(branch);
      const accessRange = access === null ? null : rangeOf(access);
      const containerRange = container === null ? null : rangeOf(container);
      const testRange = rangeOf(test);
      if (accessRange === null || containerRange === null || testRange === null) return;
      const owner = context.sourceCode.text.slice(accessRange[0], accessRange[1]);
      const key = `${containerRange[0]}:${owner}`;
      testsByChain.set(key, [...(testsByChain.get(key) ?? []), testRange]);
    };
    return {
      IfStatement: record,
      ConditionalExpression: record,
      "Program:exit": () => {
        for (const [key, tests] of testsByChain) {
          if (tests.length < 2) continue;
          const owner = key.slice(key.indexOf(":") + 1);
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
      },
    };
  },
};
