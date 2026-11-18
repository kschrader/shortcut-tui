import type { Rule } from "./plugin.ts";

type Visitor = ReturnType<NonNullable<Rule["create"]>>;
export type CallExpression = Parameters<NonNullable<Visitor["CallExpression"]>>[0];
export type Node = CallExpression["parent"];

const TEST_CALLEES = new Set(["test", "it", "describe"]);
const HOOK_CALLEES = new Set(["beforeEach", "afterEach", "beforeAll", "afterAll"]);

export const calleeRoot = (node: Node): string | null => {
  let current = node;
  while (current.type === "MemberExpression" || current.type === "CallExpression") {
    current = current.type === "MemberExpression" ? current.object : current.callee;
  }
  return current.type === "Identifier" ? current.name : null;
};

export const isTestCall = (node: CallExpression): boolean =>
  TEST_CALLEES.has(calleeRoot(node.callee) ?? "");

const isTestOrHookCall = (node: Node): boolean => {
  if (node.type !== "CallExpression") return false;
  const root = calleeRoot(node.callee) ?? "";
  return TEST_CALLEES.has(root) || HOOK_CALLEES.has(root);
};

export const inTestBody = (node: Node): boolean => {
  for (let current: Node | null = node.parent; current !== null; current = current.parent) {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionExpression" ||
      current.type === "FunctionDeclaration"
    ) {
      return current.parent !== null && isTestOrHookCall(current.parent);
    }
  }
  return false;
};
