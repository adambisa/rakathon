import { describe, it } from "node:test";

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";

import { noFalsyTernary } from "#rules/no-falsy-ternary";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parser: tseslint.parser } });
const invalidConditions = [
  "cursor === undefined",
  "undefined !== cursor",
  "cursor == null",
  "cursor !== null",
  "value === false",
  "value !== 0",
  "value === -0",
  "value === 0n",
  'value === ""',
  "value === ``",
  "value === void 0",
  "value === NaN",
  "value === Number.NaN",
  'typeof value === "undefined"',
  '"undefined" !== typeof value',
  "cursor !== undefined && status === 'ready'",
  "!(cursor === null)",
  "(cursor as unknown) === undefined",
  "cursor",
  "cursor?.id",
  "!cursor",
  "!!cursor",
  "Boolean(cursor)",
  "getCursor()",
  "cursor || fallback",
  "cursor && status === 'ready'",
];

tester.run("no-falsy-ternary", noFalsyTernary as unknown as Parameters<RuleTester["run"]>[1], {
  valid: [
    'const label = status === "ready" ? "Ready" : "Waiting";',
    'const label = active ? "On" : "Off";',
    'const label = active ? `On ${name}` : "Off";',
    'const label = !active ? "Off" : "On";',
    'const label = value === "default" ? "Default" : "Custom";',
    "const result = count > 0 ? buildItems() : [];",
    "const result = enabled === true ? buildItems() : [];",
    "const result = !(status === 'ready') ? [] : buildItems();",
    "const result = status === 'ready' && count > 0 ? buildItems() : [];",
    "const result = error instanceof Error ? error.message : String(error);",
    "const result = cursor ?? fallback;",
    "let where; if (cursor !== undefined) { where = buildWhere(cursor); }",
  ],
  invalid: [
    ...invalidConditions.map((condition) => ({
      code: `const result = ${condition} ? undefined : buildWhere(cursor);`,
      errors: [{ messageId: "useIf" }],
    })),
    {
      code: 'const label = value === null ? "Missing" : "Present";',
      errors: [{ messageId: "useIf" }],
    },
    {
      code: 'const label = value !== undefined ? "Present" : "Missing";',
      errors: [{ messageId: "useIf" }],
    },
    {
      code: 'const label = Boolean(value === null) ? "Missing" : "Present";',
      errors: [{ messageId: "useIf" }],
    },
    {
      code: 'const label = undefined ? "Present" : "Missing";',
      errors: [{ messageId: "useIf" }],
    },
  ],
});
