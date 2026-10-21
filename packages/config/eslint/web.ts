import pluginQuery from "@tanstack/eslint-plugin-query";
import pluginRouter from "@tanstack/eslint-plugin-router";
import type { ESLint } from "eslint";
import type { Config } from "eslint/config";
import prettier from "eslint-config-prettier";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";

import { base, type BaseOptions, restrictedSyntax } from "#base";

export function web(opts: BaseOptions = {}): Config[] {
  return [
    ...base(opts),
    ...pluginQuery.configs["flat/recommended-strict"],
    ...pluginRouter.configs["flat/recommended"],
    {
      files: ["**/*.{ts,tsx}"],
      ...react.configs.flat["recommended"],
    },
    { files: ["**/*.{ts,tsx}"], ...react.configs.flat["jsx-runtime"] },
    { files: ["**/*.{ts,tsx}"], ...jsxA11y.flatConfigs.recommended },
    {
      files: ["**/*.{ts,tsx}"],
      settings: { react: { version: "detect" } },
      languageOptions: { globals: { ...globals.browser, ...globals.es2023 } },
      plugins: { "react-hooks": reactHooks as unknown as ESLint.Plugin, "react-refresh": reactRefresh },
      rules: {
        ...reactHooks.configs.recommended.rules,
        "react/prop-types": "off",
        "react/no-array-index-key": "error",
        "react/self-closing-comp": "error",
        "react/jsx-no-useless-fragment": ["error", { allowExpressions: true }],
        "react/jsx-boolean-value": ["error", "never"],
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@prostapaper/db", "@prostapaper/db/*", "drizzle-orm", "drizzle-orm/*", "pg"],
                message: "Database code is server-only.",
              },
            ],
            paths: [
              {
                name: "@tanstack/react-router",
                importNames: ["Link"],
                message: 'Import Link from "#ui"; it wraps the router Link with the design-system styles.',
              },
              {
                name: "react",
                importNames: ["useMemo", "useCallback", "memo"],
                message: "The React Compiler memoizes automatically; manual memoization is redundant.",
              },
            ],
          },
        ],
        "no-restricted-syntax": [
          "error",
          ...restrictedSyntax,
          {
            selector: "MemberExpression[object.name='React'][property.name=/^(useMemo|useCallback|memo)$/]",
            message: "The React Compiler memoizes automatically; manual memoization is redundant.",
          },
        ],
        "react/forbid-elements": [
          "error",
          {
            forbid: [
              { element: "button", message: 'Use <Button> from "#ui" instead of a raw <button>.' },
              {
                element: "a",
                message: 'Use <Link> (routes) or <Anchor> (external) from "#ui" instead of a raw <a>.',
              },
              { element: "input", message: 'Use <Input> from "#ui" instead of a raw <input>.' },
            ],
          },
        ],
        "prostapaper/component-props-interface": "error",
        "prostapaper/no-raw-daisy-class": [
          "error",
          {
            classPrefixes: { toast: "Toaster" },
            classes: {
              badge: "Badge",
              btn: "Button",
              card: "Card",
              checkbox: "Checkbox",
              input: "Input",
              link: "Link",
              modal: "Modal",
              select: "Select",
              skeleton: "Skeleton",
              textarea: "Textarea",
              tooltip: "Tooltip",
            },
          },
        ],
        "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
        "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
        "unicorn/filename-case": [
          "error",
          { cases: { kebabCase: true, pascalCase: true }, ignore: [/^\$/, /^__/] },
        ],
      },
    },
    {
      files: ["**/src/ui/**/*.tsx"],
      rules: {
        "react/forbid-elements": "off",
        "prostapaper/no-raw-daisy-class": ["error", { classes: {}, classPrefixes: { toast: "Toaster" } }],
      },
    },
    {
      files: ["**/src/ui/toast.tsx"],
      rules: { "prostapaper/no-raw-daisy-class": "off" },
    },
    {
      files: ["**/routes/**/*.{ts,tsx}"],
      rules: { "react-refresh/only-export-components": "off" },
    },
    prettier,
  ];
}
