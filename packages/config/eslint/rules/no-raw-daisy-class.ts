import { AST_NODE_TYPES, ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

type Options = [{ classes: Record<string, string>; classPrefixes?: Record<string, string> }];
type MessageIds = "rawClass";

export const noRawDaisyClass = ESLintUtils.RuleCreator.withoutDocs<Options, MessageIds>({
  meta: {
    type: "suggestion",
    docs: {
      description: "Forbid base daisyUI component classes in `className`; use the `#ui` wrapper instead.",
    },
    schema: [
      {
        type: "object",
        properties: {
          classes: { type: "object", additionalProperties: { type: "string" } },
          classPrefixes: { type: "object", additionalProperties: { type: "string" } },
        },
        required: ["classes"],
        additionalProperties: false,
      },
    ],
    messages: {
      rawClass:
        'Raw daisyUI class `{{className}}` is not allowed here. Use <{{component}}> from "#ui" instead.',
    },
  },
  defaultOptions: [{ classes: {} }],
  create(context, [{ classes, classPrefixes = {} }]) {
    const { sourceCode } = context;

    const report = (node: TSESTree.Node, text: string): void => {
      for (const token of text.split(/\s+/)) {
        const component = classes[token];
        if (component !== undefined) {
          context.report({ node, messageId: "rawClass", data: { className: token, component } });
        }
      }
    };

    const reportPrefixes = (node: TSESTree.Node, text: string): void => {
      for (const match of text.matchAll(/(?:^|[\s:.[\]])([a-z][a-z-]*)(?=$|[\s:\]])/gu)) {
        const token = match[1];
        if (token === undefined) continue;
        for (const [prefix, component] of Object.entries(classPrefixes)) {
          if (token === prefix || token.startsWith(`${prefix}-`)) {
            context.report({ node, messageId: "rawClass", data: { className: token, component } });
          }
        }
      }
    };

    const walk = (node: TSESTree.Node): void => {
      if (node.type === AST_NODE_TYPES.Literal && typeof node.value === "string") {
        report(node, node.value);

        return;
      }
      if (node.type === AST_NODE_TYPES.TemplateElement) {
        report(node, node.value.cooked ?? node.value.raw);

        return;
      }
      for (const key of sourceCode.visitorKeys[node.type] ?? []) {
        const child = (node as unknown as Record<string, unknown>)[key];
        let children = [child];
        if (Array.isArray(child)) {
          children = child;
        }
        for (const item of children) {
          if (isNode(item)) {
            walk(item);
          }
        }
      }
    };

    return {
      Literal(node) {
        if (typeof node.value === "string") reportPrefixes(node, node.value);
      },
      TemplateElement(node) {
        reportPrefixes(node, node.value.cooked ?? node.value.raw);
      },
      "JSXAttribute[name.name=/^(className|class)$/]"(node: TSESTree.JSXAttribute) {
        if (node.value) {
          walk(node.value);
        }
      },
      "Property[key.name='className']"(node: TSESTree.Property) {
        walk(node.value);
      },
    };
  },
});

function isNode(value: unknown): value is TSESTree.Node {
  return (
    typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string"
  );
}
