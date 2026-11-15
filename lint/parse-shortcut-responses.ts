import type { Rule } from "./plugin.ts";

type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type CallExpression = Parameters<NonNullable<Visitor["CallExpression"]>>[0];
type Identifier = Parameters<NonNullable<Visitor["Identifier"]>>[0];
type Node = NonNullable<CallExpression["parent"]>;

const LIBRARY = "@shortcut/client/v4";
const OPERATION = /^(get|list|search|create|update|delete)[A-Z]/;
const PARSERS = new Set(["parse", "safeParse"]);
const ENVELOPE_KEYS = new Set(["entity", "entities"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

const calledMethod = (node: Node | null): string | null =>
  node?.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.property.type === "Identifier"
    ? node.callee.property.name
    : null;

const isFirstArgumentOf = (node: Node, methods: ReadonlySet<string>): boolean => {
  const { parent } = node;
  const method = calledMethod(parent);
  return (
    method !== null &&
    methods.has(method) &&
    parent?.type === "CallExpression" &&
    parent.arguments[0] === node
  );
};

const PAGINATE = new Set(["paginate"]);

const isForAwaitIterable = (node: Node): boolean =>
  node.parent?.type === "ForOfStatement" && node.parent.await && node.parent.right === node;

type Binding = { name: string; owner: Node; declaration: Node };

const contains = (outer: Node, inner: Node): boolean =>
  outer.range[0] <= inner.range[0] && inner.range[1] <= outer.range[1];

const isMemberName = (node: Identifier): boolean =>
  node.parent?.type === "MemberExpression" &&
  node.parent.property === node &&
  !node.parent.computed;

const isPropertyKey = (node: Identifier): boolean =>
  node.parent?.type === "Property" && node.parent.key === node && !node.parent.shorthand;

const enclosingFunction = (node: Node): Node => {
  let current = node;
  while (current.parent !== null && !FUNCTIONS.has(current.type)) current = current.parent;
  return current;
};

export const parseShortcutResponses: Rule = {
  meta: {
    type: "problem",
    messages: {
      unawaited:
        "`{{method}}` must be awaited, or passed to `client.paginate(...)`, so its response reaches a schema. Its generated types are not what Shortcut sends: v4 returns fields they leave out, such as formatted_vcs_branch_name.",
      unpaginated:
        "Iterate `client.paginate(...)` with `for await (const raw of ...)` and parse each `raw` with a schema from src/shortcut/schemas.ts.",
      unparsed:
        "A Shortcut response is used before a schema parses it. Pass it to a schema's `.parse(...)` from src/shortcut/schemas.ts and use what that returns; the generated types are not checked against what Shortcut sends.",
      envelope:
        "Destructure only `entity` or `entities` from a Shortcut response, then pass that to a schema's `.parse(...)`.",
    },
    schema: [],
  },
  create(context) {
    let importsLibrary = false;
    const bindings: Binding[] = [];
    const references: Identifier[] = [];

    const bindEnvelope = (pattern: Node, owner: Node) => {
      if (pattern.type !== "ObjectPattern") {
        context.report({ node: pattern, messageId: "envelope" });
        return;
      }
      for (const property of pattern.properties) {
        if (
          property.type === "Property" &&
          !property.computed &&
          property.key.type === "Identifier" &&
          ENVELOPE_KEYS.has(property.key.name) &&
          property.value.type === "Identifier"
        ) {
          bindings.push({ name: property.value.name, owner, declaration: pattern });
        } else {
          context.report({ node: property, messageId: "envelope" });
        }
      }
    };

    const bind = (id: Node, owner: Node) => {
      if (id.type === "Identifier") bindings.push({ name: id.name, owner, declaration: id });
      else bindEnvelope(id, owner);
    };

    const followResponse = (node: Node) => {
      if (isFirstArgumentOf(node, PARSERS)) return;
      const { parent } = node;
      if (parent?.type === "VariableDeclarator" && parent.init === node) {
        bind(parent.id, enclosingFunction(parent));
        return;
      }
      context.report({ node, messageId: "unparsed" });
    };

    return {
      ImportDeclaration(node) {
        if (node.source.value === LIBRARY) importsLibrary = true;
      },
      CallExpression(node) {
        if (!importsLibrary) return;
        const method = calledMethod(node);
        if (method === "paginate") {
          if (!isForAwaitIterable(node)) context.report({ node, messageId: "unpaginated" });
          return;
        }
        if (method === null || !OPERATION.test(method)) return;
        if (isFirstArgumentOf(node, PAGINATE)) return;
        if (node.parent.type !== "AwaitExpression") {
          context.report({ node, messageId: "unawaited", data: { method } });
          return;
        }
        followResponse(node.parent);
      },
      ForOfStatement(node) {
        if (!importsLibrary || !node.await || calledMethod(node.right) !== "paginate") return;
        const { left } = node;
        const [declarator] = left.type === "VariableDeclaration" ? left.declarations : [];
        if (declarator === undefined) {
          context.report({ node: left, messageId: "envelope" });
          return;
        }
        bind(declarator.id, node);
      },
      Identifier(node) {
        if (importsLibrary && !isMemberName(node) && !isPropertyKey(node)) references.push(node);
      },
      "Program:exit"() {
        for (const reference of references) {
          const binding = bindings.find(
            (candidate) =>
              candidate.name === reference.name &&
              contains(candidate.owner, reference) &&
              !contains(candidate.declaration, reference),
          );
          if (binding !== undefined && !isFirstArgumentOf(reference, PARSERS)) {
            context.report({ node: reference, messageId: "unparsed" });
          }
        }
      },
    };
  },
};
