import type { TSESLint } from "@typescript-eslint/utils";
import type { ESLint } from "eslint";

import { componentPropsInterface } from "#rules/component-props-interface";
import { maxCommentLines } from "#rules/max-comment-lines";
import { noFalsyTernary } from "#rules/no-falsy-ternary";
import { noRawDaisyClass } from "#rules/no-raw-daisy-class";

const rules: Record<string, TSESLint.RuleModule<string, readonly unknown[]>> = {
  "max-comment-lines": maxCommentLines,
  "no-falsy-ternary": noFalsyTernary,
  "component-props-interface": componentPropsInterface,
  "no-raw-daisy-class": noRawDaisyClass,
};

// typescript-eslint's RuleModule and ESLint core's RuleDefinition are structurally incompatible (the core
// context type dropped the deprecated getScope/getAncestors members); this is the one place they meet.
export const prostapaperPlugin: ESLint.Plugin = { rules: rules as unknown as ESLint.Plugin["rules"] };
