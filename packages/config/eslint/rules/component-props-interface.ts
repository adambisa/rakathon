import { AST_NODE_TYPES, ESLintUtils, TSESLint, type TSESTree } from "@typescript-eslint/utils";

const PASCAL = /^[A-Z][A-Za-z0-9]*$/;

type MessageIds = "inline" | "wrongName" | "notAbove";
type Statement = TSESTree.ProgramStatement;
type Fn = TSESTree.FunctionDeclaration | TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

export const componentPropsInterface = ESLintUtils.RuleCreator.withoutDocs<[], MessageIds>({
  meta: {
    type: "suggestion",
    docs: { description: "Components take a `<Name>Props` interface declared directly above them." },
    schema: [],
    messages: {
      inline: "Component `{{name}}` must type its props as `{{props}}`, not an inline type.",
      wrongName: "Component `{{name}}` must type its props as `{{props}}` (got `{{actual}}`).",
      notAbove: "`{{props}}` must be an interface declared directly above `{{name}}`.",
    },
  },
  defaultOptions: [],
  create(context) {
    if (!context.filename.endsWith(".tsx")) return {};
    const { sourceCode } = context;

    const isImported = (name: string): boolean => {
      const global = sourceCode.getScope(sourceCode.ast);
      const variable = [global, ...global.childScopes]
        .map((scope) => scope.set.get(name))
        .find((v) => v !== undefined);

      return variable?.defs.some((d) => d.type === TSESLint.Scope.DefinitionType.ImportBinding) ?? false;
    };

    const unwrap = (statement: Statement): TSESTree.Node | null =>
      statement.type === AST_NODE_TYPES.ExportNamedDeclaration ? statement.declaration : statement;

    const check = (statement: Statement, name: string, fn: Fn): void => {
      const param = fn.params[0];
      if (!param || param.type === AST_NODE_TYPES.TSParameterProperty) return;
      const annotation = param.typeAnnotation?.typeAnnotation;
      const props = `${name}Props`;
      if (
        annotation?.type !== AST_NODE_TYPES.TSTypeReference ||
        annotation.typeName.type !== AST_NODE_TYPES.Identifier
      ) {
        context.report({ node: param, messageId: "inline", data: { name, props } });

        return;
      }
      const actual = annotation.typeName.name;
      if (isImported(actual)) return;
      if (actual !== props) {
        context.report({ node: annotation, messageId: "wrongName", data: { name, props, actual } });

        return;
      }
      const body = sourceCode.ast.body;
      const previous = body[body.indexOf(statement) - 1];
      let declaration: TSESTree.Node | null = null;
      if (previous) {
        declaration = unwrap(previous);
      }
      if (declaration?.type !== AST_NODE_TYPES.TSInterfaceDeclaration || declaration.id.name !== props) {
        context.report({ node: annotation, messageId: "notAbove", data: { name, props } });
      }
    };

    const visit = (statement: Statement): void => {
      const node = unwrap(statement);
      if (!node) return;
      if (node.type === AST_NODE_TYPES.FunctionDeclaration && node.id && PASCAL.test(node.id.name)) {
        check(statement, node.id.name, node);
      }
      if (node.type === AST_NODE_TYPES.VariableDeclaration) {
        for (const d of node.declarations) {
          const fn = d.init;
          const isFn =
            fn?.type === AST_NODE_TYPES.ArrowFunctionExpression ||
            fn?.type === AST_NODE_TYPES.FunctionExpression;
          if (isFn && d.id.type === AST_NODE_TYPES.Identifier && PASCAL.test(d.id.name))
            check(statement, d.id.name, fn);
        }
      }
    };

    return {
      Program(program) {
        for (const statement of program.body) visit(statement);
      },
    };
  },
});
