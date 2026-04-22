import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Explicit aliases ensure Vite resolves workspace packages to source files,
      // not pnpm symlinks — required for @tailwindcss/vite to scan all components.
      "@nonclaw-ui/ui/styles": path.resolve(
        __dirname,
        "../../packages/ui/src/styles/globals.css",
      ),
      "@nonclaw-ui/ui/stores": path.resolve(
        __dirname,
        "../../packages/ui/src/stores/index.ts",
      ),
      "@nonclaw-ui/ui/embed": path.resolve(
        __dirname,
        "../../packages/ui/src/embed/index.ts",
      ),
      "@nonclaw-ui/ui": path.resolve(__dirname, "../../packages/ui/src/index.ts"),
      "@nonclaw-ui/shared/types": path.resolve(__dirname, "../../packages/shared/src/types/index.ts"),
      "@nonclaw-ui/shared/utils": path.resolve(__dirname, "../../packages/shared/src/utils/index.ts"),
      "@nonclaw-ui/shared/constants": path.resolve(__dirname, "../../packages/shared/src/constants/index.ts"),
      "@nonclaw-ui/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 25001,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
