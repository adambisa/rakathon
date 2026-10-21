import { AST_TOKEN_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

const PRAGMA = /^\s*(?:eslint|global|exported|istanbul|c8|v8|@ts-|ts-|prettier-|biome-|<reference)/;
const JSDOC_TAG = /@\w+/;

type Options = [{ max?: number; jsdocMax?: number; noHeader?: boolean }];
type MessageIds = "tooLong" | "header";

export const maxCommentLines = ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: "suggestion",
    docs: { description: "Cap comment blocks at N lines and forbid file-header comments." },
    schema: [
      {
        type: "object",
        properties: {
          max: { type: "integer", minimum: 1 },
          jsdocMax: { type: "integer", minimum: 1 },
          noHeader: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooLong:
        "Comment spans {{lines}} lines (max {{max}}). Say it in {{max}} or fix the code so it needs no saying.",
      header: "No file-header comments. The file name and its exports are the description.",
    },
  },
  defaultOptions: [{ max: 2, jsdocMax: 6, noHeader: true }],
  create(context, [{ max = 2, jsdocMax = 6, noHeader = true }]) {
    const { sourceCode } = context;
    const comments = sourceCode.getAllComments().filter((c) => !PRAGMA.test(c.value));
    const firstStatement = sourceCode.ast.body[0];
    let firstToken: TSESTree.Token | null = null;
    if (firstStatement) {
      firstToken = sourceCode.getFirstToken(firstStatement);
    }

    const ownLine = (c: TSESTree.Comment): boolean =>
      (sourceCode.lines[c.loc.start.line - 1] ?? "").slice(0, c.loc.start.column).trim() === "";

    const blocks: TSESTree.Comment[][] = [];
    for (const c of comments) {
      const prev = blocks.at(-1);
      const last = prev?.at(-1);
      const continues =
        last !== undefined &&
        c.type === AST_TOKEN_TYPES.Line &&
        last.type === AST_TOKEN_TYPES.Line &&
        ownLine(c) &&
        ownLine(last) &&
        c.loc.start.line === last.loc.end.line + 1;
      if (prev && continues) {
        prev.push(c);
      } else {
        blocks.push([c]);
      }
    }

    return {
      Program() {
        for (const block of blocks) {
          const first = block[0];
          const last = block.at(-1);
          if (!first || !last) continue;
          const lines = last.loc.end.line - first.loc.start.line + 1;
          const isJsdoc =
            first.type === AST_TOKEN_TYPES.Block &&
            first.value.startsWith("*") &&
            JSDOC_TAG.test(first.value);
          let limit = max;
          if (isJsdoc) {
            limit = jsdocMax;
          }
          const loc = { start: first.loc.start, end: last.loc.end };
          if (noHeader && firstToken && last.loc.end.line < firstToken.loc.start.line && !isJsdoc) {
            context.report({ loc, messageId: "header" });
            continue;
          }
          if (lines > limit) {
            context.report({ loc, messageId: "tooLong", data: { lines, max: limit } });
          }
        }
      },
    };
  },
});
