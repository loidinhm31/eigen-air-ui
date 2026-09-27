import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST || "localhost";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@eigen-air-ui/ui/styles": path.resolve(__dirname, "../../packages/ui/src/styles/globals.css"),
      "@eigen-air-ui/ui/stores": path.resolve(__dirname, "../../packages/ui/src/stores/index.ts"),
      "@eigen-air-ui/ui/embed": path.resolve(__dirname, "../../packages/ui/src/embed/index.ts"),
      "@eigen-air-ui/ui": path.resolve(__dirname, "../../packages/ui/src/index.ts"),
      "@eigen-air-ui/shared/types": path.resolve(__dirname, "../../packages/shared/src/types/index.ts"),
      "@eigen-air-ui/shared/utils": path.resolve(__dirname, "../../packages/shared/src/utils/index.ts"),
      "@eigen-air-ui/shared/constants": path.resolve(__dirname, "../../packages/shared/src/constants/index.ts"),
      "@eigen-air-ui/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host,
    hmr: host !== "localhost" ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { outDir: "dist", sourcemap: true },
});
