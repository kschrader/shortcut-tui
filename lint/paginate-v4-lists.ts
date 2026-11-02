import type { Rule } from "./plugin.ts";

type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type CallExpression = Parameters<NonNullable<Visitor["CallExpression"]>>[0];

const LIBRARY = "@shortcut/client/v4";
const PAGED_OPERATION = /^(search|list)[A-Z]/;

const calledMethod = (node: CallExpression): string | null =>
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.property.type === "Identifier"
    ? node.callee.property.name
    : null;

const isPaginateArgument = (node: CallExpression): boolean => {
  const { parent } = node;
  return (
    parent.type === "CallExpression" &&
    calledMethod(parent) === "paginate" &&
    parent.arguments[0] === node
  );
};

export const paginateV4Lists: Rule = {
  meta: {
    type: "problem",
    messages: {
      onePage:
        "`{{method}}` returns one page (10 entities unless `limit` says otherwise, at most 100). Pass the call to `client.paginate(...)` so every page is read.",
    },
    schema: [],
  },
  create(context) {
    let importsLibrary = false;
    return {
      ImportDeclaration(node) {
        if (node.source.value === LIBRARY) importsLibrary = true;
      },
      CallExpression(node) {
        const method = calledMethod(node);
        if (!importsLibrary || method === null || !PAGED_OPERATION.test(method)) return;
        if (!isPaginateArgument(node)) {
          context.report({ node, messageId: "onePage", data: { method } });
        }
      },
    };
  },
};
