import type { Rule } from "./plugin.ts";

type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type CallExpression = Parameters<NonNullable<Visitor["CallExpression"]>>[0];

const COMBINATORS = new Set(["all", "allSettled", "any", "race"]);
const MAPPERS = new Set(["map", "flatMap"]);
const TEST_FILE = /\.test\.tsx?$/;

const memberCall = (node: CallExpression) =>
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.property.type === "Identifier"
    ? { object: node.callee.object, method: node.callee.property.name }
    : null;

const isPromiseCombinator = (node: CallExpression): string | null => {
  const call = memberCall(node);
  if (call === null || !COMBINATORS.has(call.method)) return null;
  return call.object.type === "Identifier" && call.object.name === "Promise" ? call.method : null;
};

const isMappedArray = (node: CallExpression["arguments"][number] | undefined): boolean => {
  if (node?.type !== "CallExpression") return false;
  const call = memberCall(node);
  return call !== null && MAPPERS.has(call.method);
};

export const boundFanOut: Rule = {
  meta: {
    type: "problem",
    messages: {
      unbounded:
        "Promise.{{combinator}} over a mapped array starts every request at once: 500 stories meant 500 concurrent Shortcut calls and a 429. Use settleLimited from src/concurrency.ts to cap how many run in flight.",
    },
    schema: [],
  },
  create(context) {
    if (TEST_FILE.test(context.filename)) return {};
    return {
      CallExpression(node) {
        const combinator = isPromiseCombinator(node);
        if (combinator === null || !isMappedArray(node.arguments[0])) return;
        context.report({ node, messageId: "unbounded", data: { combinator } });
      },
    };
  },
};
