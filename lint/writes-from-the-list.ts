import type { Rule } from "./plugin.ts";

type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type CallExpression = Parameters<NonNullable<Visitor["CallExpression"]>>[0];
type Node = CallExpression["parent"];

const LIBRARY = "@shortcut/client/v4";

export const V4_WRITE = /^(create|update|delete|enable|disable|link|unlink|upload)[A-Z]/;

export const APPROVED_WRITES: Readonly<Partial<Record<string, readonly string[]>>> = {
  moveStory: ["updateStory"],
};

const GRAPHQL_MUTATION = /^\s*(query=)?\s*mutation\b\s*\w*\s*[({]/;

const calledMethod = (node: CallExpression): string | null =>
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.property.type === "Identifier"
    ? node.callee.property.name
    : null;

const isFunction = (node: Node | null | undefined): boolean =>
  node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";

const ownerName = (node: Node): string | null => {
  if (
    (node.type === "Property" || node.type === "MethodDefinition") &&
    !node.computed &&
    node.key.type === "Identifier" &&
    isFunction(node.value)
  ) {
    return node.key.name;
  }
  if (
    node.type === "VariableDeclarator" &&
    node.id.type === "Identifier" &&
    isFunction(node.init)
  ) {
    return node.id.name;
  }
  if (node.type === "FunctionDeclaration") return node.id?.name ?? null;
  return null;
};

const enclosingOwner = (node: CallExpression): string | null => {
  for (let current: Node | null = node.parent; current !== null; current = current.parent) {
    const name = ownerName(current);
    if (name !== null) return name;
  }
  return null;
};

export const writesFromTheList: Rule = {
  meta: {
    type: "problem",
    messages: {
      unlisted:
        "`{{method}}` writes to Shortcut from `{{owner}}`, which is not an approved write. The app may only make the writes in APPROVED_WRITES in lint/writes-from-the-list.ts. If this write is meant, add it there so the change shows in review.",
      mutation:
        "This GraphQL text is a mutation. The app only reads from GitHub, so writes need an approved entry like the Shortcut ones in lint/writes-from-the-list.ts.",
    },
    schema: [],
  },
  create(context) {
    let importsLibrary = false;
    const checkGraphql = (node: Parameters<NonNullable<Visitor["TemplateElement"]>>[0]) => {
      if (GRAPHQL_MUTATION.test(node.value.cooked ?? node.value.raw)) {
        context.report({ node, messageId: "mutation" });
      }
    };
    return {
      ImportDeclaration(node) {
        if (node.source.value === LIBRARY) importsLibrary = true;
      },
      CallExpression(node) {
        const method = calledMethod(node);
        if (!importsLibrary || method === null || !V4_WRITE.test(method)) return;
        const owner = enclosingOwner(node);
        if (owner !== null && APPROVED_WRITES[owner]?.includes(method) === true) return;
        context.report({
          node,
          messageId: "unlisted",
          data: { method, owner: owner ?? "top level" },
        });
      },
      TemplateElement: checkGraphql,
      Literal(node) {
        if (typeof node.value === "string" && GRAPHQL_MUTATION.test(node.value)) {
          context.report({ node, messageId: "mutation" });
        }
      },
    };
  },
};
