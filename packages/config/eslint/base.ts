import js from "@eslint/js";
import json from "@eslint/json";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import { type Config, defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import importX from "eslint-plugin-import-x";
import packageJson from "eslint-plugin-package-json";
import regexp from "eslint-plugin-regexp";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

import { prostapaperPlugin } from "#rules/plugin";

export interface BaseOptions {
  tsconfigRootDir?: string;
  allowDefaultProject?: string[];
}

const CODE = ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"];

export const restrictedSyntax = [
  {
    selector: "TSEnumDeclaration",
    message: "Use a union type or a const object instead of an enum.",
  },
];

export function base(opts: BaseOptions = {}): Config[] {
  const { tsconfigRootDir, allowDefaultProject = [] } = opts;
  const parserOptions: { projectService: { allowDefaultProject: string[] }; tsconfigRootDir?: string } = {
    projectService: { allowDefaultProject },
  };
  if (tsconfigRootDir !== undefined) {
    parserOptions.tsconfigRootDir = tsconfigRootDir;
  }

  return defineConfig(
    {
      ignores: ["**/dist/**", "**/generated/**", "**/.turbo/**", "**/node_modules/**", "**/*.gen.ts"],
    },
    {
      files: CODE,
      extends: [
        js.configs.recommended,
        tseslint.configs.strictTypeChecked,
        tseslint.configs.stylisticTypeChecked,
        unicorn.configs.recommended,
        regexp.configs["flat/recommended"],
        comments.recommended,
      ],
      linterOptions: { reportUnusedDisableDirectives: "error" },
      plugins: {
        "simple-import-sort": simpleImportSort,
        "import-x": importX,
        prostapaper: prostapaperPlugin,
      },
      languageOptions: { globals: { ...globals.node, ...globals.es2023 }, parserOptions },
      rules: {
        "prostapaper/no-falsy-ternary": "error",
        "prostapaper/max-comment-lines": ["error", { max: 2, jsdocMax: 6, noHeader: true }],

        "@eslint-community/eslint-comments/no-use": ["warn", { allow: [] }],
        "@eslint-community/eslint-comments/require-description": "error",
        "@eslint-community/eslint-comments/no-unused-disable": "error",

        eqeqeq: ["error", "always"],
        curly: ["error", "all"],
        "no-var": "error",
        "object-shorthand": "error",
        "prefer-template": "error",
        "no-param-reassign": ["error", { props: true }],
        "no-await-in-loop": "error",
        "no-implicit-coercion": "error",
        "no-nested-ternary": "error",
        "no-unneeded-ternary": ["error", { defaultAssignment: false }],
        "default-case-last": "error",
        "no-useless-rename": "error",
        "no-console": ["error", { allow: ["info", "warn", "error"] }],
        "padding-line-between-statements": ["error", { blankLine: "always", prev: "*", next: "return" }],
        "no-restricted-syntax": ["error", ...restrictedSyntax],

        "simple-import-sort/imports": [
          "error",
          {
            groups: [
              [String.raw`^\u0000`],
              ["^node:"],
              [String.raw`^@?\w`],
              ["^@prostapaper/"],
              ["^#"],
              [String.raw`^\.`],
            ],
          },
        ],
        "simple-import-sort/exports": "error",
        "import-x/first": "error",
        "import-x/newline-after-import": "error",
        "import-x/no-duplicates": ["error", { "prefer-inline": true }],

        "@typescript-eslint/no-restricted-types": [
          "error",
          { types: { Pick: "Use an explicit domain type instead of Pick." } },
        ],

        "@typescript-eslint/consistent-type-imports": [
          "error",
          { prefer: "type-imports", fixStyle: "inline-type-imports" },
        ],
        "@typescript-eslint/consistent-type-exports": [
          "error",
          { fixMixedExportsWithInlineTypeSpecifier: true },
        ],
        "@typescript-eslint/no-import-type-side-effects": "error",
        "@typescript-eslint/method-signature-style": ["error", "property"],
        "@typescript-eslint/strict-boolean-expressions": "error",
        "@typescript-eslint/promise-function-async": "error",
        "@typescript-eslint/require-array-sort-compare": "error",
        "@typescript-eslint/switch-exhaustiveness-check": "error",
        "@typescript-eslint/max-params": ["error", { max: 3 }],
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
        "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],

        "unicorn/no-null": "off",
        "unicorn/prevent-abbreviations": "off",
        "unicorn/no-array-reduce": "off",
        "unicorn/no-array-callback-reference": "off",
        "unicorn/prefer-ternary": "off",
        "unicorn/consistent-function-scoping": "off",
        "unicorn/consistent-compound-words": "off",
        "unicorn/import-style": "off",
        "unicorn/expiring-todo-comments": "off",

        "unicorn/filename-case": ["error", { case: "kebabCase" }],
        "unicorn/no-useless-undefined": ["error", { checkArguments: false }],
      },
    },
    {
      files: ["**/*.{ts,tsx,mts,cts}"],
      ignores: ["**/*.d.ts"],
      rules: {
        "@typescript-eslint/no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [".", "./*", "../*"],
                message:
                  'Relative imports are not allowed. Use "#…" for this package or "@prostapaper/…" for workspace packages.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ["**/package.json"],
      extends: [packageJson.configs.recommended],
    },
    {
      files: ["**/*.json"],
      ignores: ["**/package.json", "**/tsconfig*.json", "**/.vscode/*.json"],
      language: "json/json",
      plugins: { json },
      extends: [json.configs.recommended],
    },
    {
      files: ["**/tsconfig*.json", "**/.vscode/*.json"],
      language: "json/jsonc",
      plugins: { json },
      extends: [json.configs.recommended],
    },
    prettier,
  );
}
