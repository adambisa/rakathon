import { cp } from "node:fs/promises";

import { build } from "esbuild";

await build({
  entryPoints: { server: "src/index.ts", "seed-users": "scripts/seed-users.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  minify: true,
  keepNames: true,
  logLevel: "info",
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

await cp("src/sample-cases", "dist/sample-cases", { recursive: true });
