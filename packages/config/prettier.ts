import { fileURLToPath } from "node:url";

import type { Config } from "prettier";

const config: Config = {
  printWidth: 110,
  singleQuote: false,
  trailingComma: "all",
  semi: true,
  overrides: [
    {
      files: "apps/web/**/*.{ts,tsx,css,html}",
      options: {
        plugins: [fileURLToPath(import.meta.resolve("prettier-plugin-tailwindcss"))],
        tailwindStylesheet: fileURLToPath(new URL("../../apps/web/src/styles.css", import.meta.url)),
      },
    },
  ],
};

export default config;
