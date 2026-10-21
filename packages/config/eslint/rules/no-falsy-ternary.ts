import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

function unwrap(node: TSESTree.Expression): TSESTree.Expression {
  if (
    [
      AST_NODE_TYPES.TSAsExpression,
      AST_NODE_TYPES.TSTypeAssertion,
      AST_NODE_TYPES.TSNonNullExpression,
      AST_NODE_TYPES.TSSatisfiesExpression,
      AST_NODE_TYPES.ChainExpression,
    ].includes(node.type) &&
    "expression" in node &&
    typeof node.expression !== "boolean"
  ) {
    return unwrap(node.expression);
  }

  return node;
}

function isFalsyValue(expression: TSESTree.Expression): boolean {
  const node = unwrap(expression);
  if (node.type === AST_NODE_TYPES.Literal) {
    const falsyValues: readonly unknown[] = [null, false, 0, 0n, ""];

    return falsyValues.includes(node.value);
  }
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name === "undefined" || node.name === "NaN";
  }
  if (node.type === AST_NODE_TYPES.UnaryExpression) {
    return node.operator === "void" || (node.operator === "-" && isFalsyValue(node.argument));
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral) {
    return node.expressions.length === 0 && node.quasis.every((part) => part.value.cooked === "");
  }
  if (node.type === AST_NODE_TYPES.MemberExpression) {
    return (
      node.object.type === AST_NODE_TYPES.Identifier &&
      node.object.name === "Number" &&
      node.property.type === AST_NODE_TYPES.Identifier &&
      node.property.name === "NaN"
    );
  }

  return false;
}

function checksFalsyValue(expression: TSESTree.Expression): boolean {
  const node = unwrap(expression);
  if (node.type === AST_NODE_TYPES.BinaryExpression) {
    if (
      !["==", "!=", "===", "!=="].includes(node.operator) ||
      node.left.type === AST_NODE_TYPES.PrivateIdentifier
    ) {
      return false;
    }

    return (
      isFalsyValue(node.left) ||
      isFalsyValue(node.right) ||
      isUndefinedTypeCheck(node.left, node.right) ||
      isUndefinedTypeCheck(node.right, node.left)
    );
  }
  if (node.type === AST_NODE_TYPES.LogicalExpression) {
    return checksFalsyValue(node.left) || checksFalsyValue(node.right);
  }
  if (node.type === AST_NODE_TYPES.UnaryExpression) {
    return checksFalsyValue(node.argument);
  }

  if (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === "Boolean"
  ) {
    const argument = node.arguments[0];
    if (argument && argument.type !== AST_NODE_TYPES.SpreadElement) {
      return checksFalsyValue(argument);
    }
  }

  return isFalsyValue(node);
}

function isUndefinedTypeCheck(left: TSESTree.Expression, right: TSESTree.Expression): boolean {
  const value = unwrap(left);
  const comparison = unwrap(right);

  return (
    value.type === AST_NODE_TYPES.UnaryExpression &&
    value.operator === "typeof" &&
    comparison.type === AST_NODE_TYPES.Literal &&
    comparison.value === "undefined"
  );
}

function usesTruthiness(expression: TSESTree.Expression): boolean {
  const node = unwrap(expression);
  if (node.type === AST_NODE_TYPES.BinaryExpression) {
    return false;
  }
  if (node.type === AST_NODE_TYPES.LogicalExpression) {
    return usesTruthiness(node.left) || usesTruthiness(node.right);
  }
  if (node.type === AST_NODE_TYPES.UnaryExpression && node.operator === "!") {
    return usesTruthiness(node.argument);
  }

  return true;
}

function isString(expression: TSESTree.Expression): boolean {
  const node = unwrap(expression);

  return (
    node.type === AST_NODE_TYPES.TemplateLiteral ||
    (node.type === AST_NODE_TYPES.Literal && typeof node.value === "string")
  );
}

export const noFalsyTernary = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: "suggestion",
    docs: { description: "Use explicit if statements for falsy guards and value-dependent ternaries." },
    schema: [],
    messages: {
      useIf:
        "Use an explicit if statement for falsy/nullish guards. Ternaries may select strings or use explicit non-falsy comparisons.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      ConditionalExpression(node) {
        const stringSelection = isString(node.consequent) && isString(node.alternate);
        if (checksFalsyValue(node.test) || (usesTruthiness(node.test) && !stringSelection)) {
          context.report({ node, messageId: "useIf" });
        }
      },
    };
  },
});
