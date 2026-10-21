import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

const documentationFiles = ["pro-lekare", "pro-it-a-dpo"].map((guide) => ({
  guide,
  path: fileURLToPath(new URL(`../../docs/dokumentace/${guide}.md`, import.meta.url)),
}));

export default defineConfig({
  plugins: [
    {
      name: "documentation-markdown",
      resolveId(id) {
        if (id === "virtual:documentation") return "\0virtual:documentation";

        return null;
      },
      configureServer(server) {
        const paths = documentationFiles.map((file) => file.path);
        server.watcher.add(paths);
        server.watcher.on("change", (path) => {
          if (!paths.includes(path)) return;
          const module = server.moduleGraph.getModuleById("\0virtual:documentation");
          if (module) server.moduleGraph.invalidateModule(module);
          server.ws.send({ type: "full-reload" });
        });
      },
      async load(id) {
        if (id !== "\0virtual:documentation") return;
        const entries = await Promise.all(
          documentationFiles.map(async ({ guide, path }) => [guide, await readFile(path, "utf8")]),
        );

        return `export default ${JSON.stringify(Object.fromEntries(entries))};`;
      },
    },
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react({ compiler: true }),
    tailwindcss(),
    Icons({ compiler: "jsx", jsx: "react" }),
  ],
  server: {
    proxy: { "/api": "http://localhost:3000" },
  },
});
