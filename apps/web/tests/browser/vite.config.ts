import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    Icons({ compiler: "jsx", jsx: "react" }),
    {
      name: "documentation-stub",
      resolveId(id) {
        if (id === "virtual:documentation") return "\0virtual:documentation";

        return null;
      },
      load(id) {
        if (id === "\0virtual:documentation") return "export default {};";

        return null;
      },
    },
  ],
  server: { host: "127.0.0.1", port: 5192, strictPort: true },
});
