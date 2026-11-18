import type { Rule } from "./plugin.ts";

const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
const COMPANION = /\.test\./;

const isSibling = (source: string): boolean =>
  source.startsWith("./") && !source.slice(2).includes("/") && !COMPANION.test(source);

const directoryOf = (source: string): string => source.slice(0, source.lastIndexOf("/") + 1);

export const colocatedTests: Rule = {
  meta: {
    type: "suggestion",
    messages: {
      detached:
        "This test imports code only from {{directories}}. Move it beside the module it tests, so each test lives next to its subject.",
    },
    schema: [],
  },
  create(context) {
    if (!TEST_FILE.test(context.physicalFilename)) return {};
    const relative: string[] = [];
    const note = (source: unknown) => {
      if (typeof source === "string" && source.startsWith(".")) relative.push(source);
    };
    return {
      ImportDeclaration(node) {
        const typeOnly =
          node.importKind === "type" ||
          (node.specifiers.length > 0 &&
            node.specifiers.every(
              (specifier) =>
                specifier.type === "ImportSpecifier" && specifier.importKind === "type",
            ));
        if (!typeOnly) note(node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") note(node.source.value);
      },
      "Program:exit"(node) {
        if (relative.length === 0 || relative.some(isSibling)) return;
        const directories = [...new Set(relative.map(directoryOf))].join(", ");
        context.report({ node, messageId: "detached", data: { directories } });
      },
    };
  },
};
