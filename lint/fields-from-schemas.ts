import type { Rule } from "./plugin.ts";

type Visitor = ReturnType<NonNullable<Rule["create"]>>;
type Property = Parameters<NonNullable<Visitor["Property"]>>[0];
type Declarator = Parameters<NonNullable<Visitor["VariableDeclarator"]>>[0];

const LIBRARY = "@shortcut/client/v4";
const FIELD_LIST_NAME = /_FIELDS$/;
const FIELD_LIST_TEXT = /^,?[a-z_.]+(,[a-z_.]+)*,?$/;
const NAMED_VALUES = new Set(["Identifier", "MemberExpression"]);

const isFieldsKey = (node: Property): boolean =>
  !node.computed && node.key.type === "Identifier" && node.key.name === "fields";

const stringText = (init: Declarator["init"]): string | null =>
  init?.type === "Literal" && typeof init.value === "string" ? init.value : null;

const templateText = (init: Declarator["init"]): string | null =>
  init?.type === "TemplateLiteral" ? init.quasis.map((quasi) => quasi.value.raw).join("") : null;

const literalText = (init: Declarator["init"]): string | null =>
  stringText(init) ?? templateText(init);

export const fieldsFromSchemas: Rule = {
  meta: {
    type: "problem",
    messages: {
      inline:
        "Pass a field list built by fieldsOf(...) in src/shortcut/schemas.ts, not a literal. A hand-written list can miss a field the schema needs, so every search fails to parse, and a nested name such as sub_task_stories.workflow_state gets a 400.",
      handWritten:
        "Build {{name}} with fieldsOf(shape) from the shape its schema parses, so the fields Shortcut is asked for and the fields the schema reads cannot drift apart.",
    },
    schema: [],
  },
  create(context) {
    let importsLibrary = false;
    return {
      ImportDeclaration(node) {
        if (node.source.value === LIBRARY) importsLibrary = true;
      },
      Property(node) {
        if (importsLibrary && isFieldsKey(node) && !NAMED_VALUES.has(node.value.type)) {
          context.report({ node: node.value, messageId: "inline" });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || !FIELD_LIST_NAME.test(node.id.name)) return;
        const text = literalText(node.init);
        if (text !== null && FIELD_LIST_TEXT.test(text)) {
          context.report({ node, messageId: "handWritten", data: { name: node.id.name } });
        }
      },
    };
  },
};
