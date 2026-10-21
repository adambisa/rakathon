import { rm } from "node:fs/promises";

import { build } from "esbuild";

export interface LambdaBuildOptions {
  outdir?: string | undefined;
  external?: string[] | undefined;
}

/** One ESM bundle per Lambda entry; `require` is shimmed for CommonJS dependencies. */
export async function buildLambda(options: LambdaBuildOptions = {}): Promise<string> {
  const outdir = options.outdir ?? "dist";
  await rm(outdir, { recursive: true, force: true });
  await build({
    entryPoints: { handler: "src/handler.ts" },
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    sourcemap: true,
    minify: true,
    keepNames: true,
    logLevel: "info",
    external: options.external ?? [],
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });

  return outdir;
}
