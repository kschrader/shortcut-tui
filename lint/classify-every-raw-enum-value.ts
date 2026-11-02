import type { Rule } from "./plugin.ts";

type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type CallExpression = Parameters<NonNullable<Visitor["CallExpression"]>>[0];
type Node = CallExpression["parent"];

const RAW_SCHEMA = /^Raw\w*Schema$/;

const isZodEnum = (node: CallExpression) =>
  node.callee.type === "MemberExpression" &&
  !node.callee.computed &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "z" &&
  node.callee.property.type === "Identifier" &&
  node.callee.property.name === "enum";

const schemaField = (node: Node): string | null => {
  let field: string | null = null;
  for (let current: Node | null = node; current !== null; current = current.parent) {
    if (current.type === "Property" && current.key.type === "Identifier") {
      field = current.key.name;
    }
    if (current.type === "VariableDeclarator") {
      return current.id.type === "Identifier" && RAW_SCHEMA.test(current.id.name) ? field : null;
    }
  }
  return null;
};

const stringValue = (node: Node): string | null =>
  node.type === "Literal" && typeof node.value === "string" ? node.value : null;

const comparedField = (node: Node): string | null => {
  const access = node.type === "ChainExpression" ? node.expression : node;
  return access.type === "MemberExpression" &&
    !access.computed &&
    access.property.type === "Identifier"
    ? access.property.name
    : null;
};

const reference = (field: string, value: string) => `${field}=${value}`;

export const classifyEveryRawEnumValue: Rule = {
  meta: {
    type: "problem",
    messages: {
      unclassified:
        '{{field}} can be "{{value}}", but nothing outside the schema compares {{field}} with it, so a pull request in that state falls through to unknown. Compare it in the classification or awaitsMergeability, or list it under {{field}} in DECIDED_BY_OTHER_FIELDS when another field decides the state.',
    },
    schema: [],
  },
  create(context) {
    const allowed: { field: string; value: string; node: Node }[] = [];
    const referenced = new Set<string>();
    return {
      CallExpression(node) {
        if (!isZodEnum(node)) return;
        const field = schemaField(node);
        const [values] = node.arguments;
        if (field === null || values?.type !== "ArrayExpression") return;
        for (const element of values.elements) {
          const value = element === null ? null : stringValue(element);
          if (element !== null && value !== null) allowed.push({ field, value, node: element });
        }
      },
      BinaryExpression(node) {
        if (node.operator !== "===" && node.operator !== "!==") return;
        for (const [side, other] of [
          [node.left, node.right],
          [node.right, node.left],
        ] as const) {
          const value = stringValue(side);
          const field = comparedField(other);
          if (value !== null && field !== null) referenced.add(reference(field, value));
        }
      },
      Property(node) {
        if (node.key.type !== "Identifier" || node.value.type !== "ArrayExpression") return;
        for (const element of node.value.elements) {
          const value = element === null ? null : stringValue(element);
          if (value !== null) referenced.add(reference(node.key.name, value));
        }
      },
      "Program:exit"() {
        for (const { field, value, node } of allowed) {
          if (referenced.has(reference(field, value))) continue;
          context.report({ node, messageId: "unclassified", data: { field, value } });
        }
      },
    };
  },
};
