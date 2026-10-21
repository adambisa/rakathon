import { node } from "@prostapaper/config/eslint/node";

export default [
  ...node({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["src/redcap-schema.ts"],
    rules: { "prostapaper/max-comment-lines": ["error", { max: 2, jsdocMax: 6, noHeader: false }] },
  },
];
