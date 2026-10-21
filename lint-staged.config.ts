export default {
  "*.{ts,tsx,js,mjs,cjs,json}": [
    "eslint --flag v10_config_lookup_from_file --no-warn-ignored --max-warnings 0 --fix",
    "prettier --write",
  ],
  "*.{jsonc,md,mdx,yaml,yml,css,html}": "prettier --write",
  "*.tf": ["terraform fmt", () => "node infra/check-terraform-format.mjs"],
};
