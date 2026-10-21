import { node } from "@prostapaper/config/eslint/node";

export default [
  ...node({ tsconfigRootDir: import.meta.dirname, hono: true }),
  { files: ["src/database/service.ts", "scripts/seed-users.ts"], rules: { "n/no-process-env": "off" } },
];
