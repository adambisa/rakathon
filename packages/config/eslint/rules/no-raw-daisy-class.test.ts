import { describe, it } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import { noRawDaisyClass } from "#rules/no-raw-daisy-class";

RuleTester.describe = describe;
RuleTester.it = it;

const options = [{ classes: { btn: "Button" }, classPrefixes: { toast: "Toaster" } }];

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run("no-raw-daisy-class", noRawDaisyClass as unknown as Parameters<RuleTester["run"]>[1], {
  valid: [
    'import { toast } from "#lib/toast"; toast.error(error);',
    '<div className="alert alert-error" />',
    'const label = "Toast · toast.success / toast.error / toast.info";',
    'const name = "toaster";',
    '<button className="btn-primary" />',
  ].map((code) => ({ code, options })),
  invalid: [
    { code: '<div className="toast" />', errors: [{ messageId: "rawClass" }] },
    { code: '<div className="toast-end" />', errors: [{ messageId: "rawClass" }] },
    { code: '<div className="sm:toast-bottom" />', errors: [{ messageId: "rawClass" }] },
    {
      code: 'const classes = "toast toast-top";',
      errors: [{ messageId: "rawClass" }, { messageId: "rawClass" }],
    },
    { code: "const classes = `toast ${position}`;", errors: [{ messageId: "rawClass" }] },
    { code: 'const classes = cx("toast", position);', errors: [{ messageId: "rawClass" }] },
    { code: '<div className="[&>.toast]:hidden" />', errors: [{ messageId: "rawClass" }] },
    { code: '<button className="btn" />', errors: [{ messageId: "rawClass" }] },
    { code: 'const props = { className: cx("btn", extra) };', errors: [{ messageId: "rawClass" }] },
    { code: "<div className={`toast-${position}`} />", errors: [{ messageId: "rawClass" }] },
  ].map((test) => ({ ...test, options })),
});
