import type { Rule } from "./plugin.ts";
import { inTestBody, type Node } from "./test-calls.ts";

const TIMER_MODULES = new Set(["node:timers/promises", "timers/promises"]);

const isMember = (node: Node, object: string, property: string): boolean =>
  node.type === "MemberExpression" &&
  !node.computed &&
  node.object.type === "Identifier" &&
  node.object.name === object &&
  node.property.type === "Identifier" &&
  node.property.name === property;

const isSetTimeout = (node: Node): boolean =>
  (node.type === "Identifier" && node.name === "setTimeout") ||
  isMember(node, "globalThis", "setTimeout");

const onlyExpression = (body: Node | null): Node | null => {
  if (body?.type !== "BlockStatement") return body;
  const [statement, ...rest] = body.body;
  return statement?.type === "ExpressionStatement" && rest.length === 0
    ? statement.expression
    : null;
};

const resolvesAfterTimeout = (node: Node): boolean => {
  if (node.type !== "NewExpression") return false;
  if (node.callee.type !== "Identifier" || node.callee.name !== "Promise") return false;
  const [executor] = node.arguments;
  if (executor?.type !== "ArrowFunctionExpression" && executor?.type !== "FunctionExpression") {
    return false;
  }
  const [resolve] = executor.params;
  if (resolve?.type !== "Identifier") return false;
  const call = onlyExpression(executor.body);
  if (call?.type !== "CallExpression" || !isSetTimeout(call.callee)) return false;
  const [handler] = call.arguments;
  if (handler?.type === "Identifier") return handler.name === resolve.name;
  return (
    handler?.type === "ArrowFunctionExpression" &&
    handler.body.type === "CallExpression" &&
    handler.body.callee.type === "Identifier" &&
    handler.body.callee.name === resolve.name
  );
};

export const noFixedSleep: Rule = {
  meta: {
    type: "problem",
    messages: {
      sleep:
        "Wait for the event this test depends on instead of sleeping a fixed time. In UI tests, `await when(() => ...)` from src/ui/frame.tsx resolves when a message or call arrives; to show keys did nothing, end with a key that dispatches and wait for it. Elsewhere, await the operation or the promise its handler resolves. A sleep guesses how long the work takes and fails on a slow machine.",
    },
    schema: [],
  },
  create(context) {
    const timers = new Set<string>();
    const callsSleep = (node: Node): boolean =>
      node.type === "CallExpression" &&
      ((node.callee.type === "Identifier" && timers.has(node.callee.name)) ||
        isMember(node.callee, "Bun", "sleep") ||
        isMember(node.callee, "scheduler", "wait"));
    const isSleep = (node: Node): boolean => resolvesAfterTimeout(node) || callsSleep(node);
    return {
      ImportDeclaration(node) {
        if (!TIMER_MODULES.has(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "setTimeout"
          ) {
            timers.add(specifier.local.name);
          }
        }
      },
      AwaitExpression(node) {
        if (isSleep(node.argument) && inTestBody(node)) {
          context.report({ node, messageId: "sleep" });
        }
      },
      CallExpression(node) {
        if (isMember(node.callee, "Bun", "sleepSync") && inTestBody(node)) {
          context.report({ node, messageId: "sleep" });
        }
      },
    };
  },
};
