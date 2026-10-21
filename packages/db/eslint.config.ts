import { node } from "@prostapaper/config/eslint/node";

export default [
  ...node({ tsconfigRootDir: import.meta.dirname }),
  {
    files: ["scripts/seed.ts"],
    rules: { "n/no-process-env": "off" },
  },
];
