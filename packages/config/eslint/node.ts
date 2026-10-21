import type { Config } from "eslint/config";
import prettier from "eslint-config-prettier";
import hono from "eslint-plugin-hono";
import n from "eslint-plugin-n";

import { base, type BaseOptions } from "#base";

export interface NodeOptions extends BaseOptions {
  hono?: boolean;
}

export function node(opts: NodeOptions = {}): Config[] {
  const { hono: withHono = false, ...baseOpts } = opts;
  const configs: Config[] = [
    ...base(baseOpts),
    {
      files: ["**/*.{ts,mts,cts,js,mjs,cjs}"],
      plugins: { n },
      rules: {
        "n/no-deprecated-api": "error",
        "n/no-process-env": "error",
        "n/prefer-promises/fs": "error",
        "n/prefer-promises/dns": "error",
        "n/handle-callback-err": "error",
        "@typescript-eslint/explicit-module-boundary-types": "error",
      },
    },
    { files: ["**/env.ts"], rules: { "n/no-process-env": "off" } },
  ];

  // Environment is read in exactly one module per app; everything else receives it as a parameter.

  if (withHono) {
    configs.push(
      { files: ["**/*.ts"], ...hono.configs.recommended },
      {
        files: ["**/*.ts"],
        rules: { "hono/prefer-http-exception": "error", "hono/global-middleware-placement": "error" },
      },
    );
  }

  configs.push(
    { files: ["**/cli.ts", "**/cli/**/*.ts", "**/bin/**/*.ts"], rules: { "unicorn/no-process-exit": "off" } },
    prettier,
  );

  return configs;
}
