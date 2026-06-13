import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { defineConfig, UserConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: true,
  },
  server: {
    cors: true, // Enables CORS headers on the Vite local dev server
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: false,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
  ],
  resolve: {
    tsconfigPaths: true,
  },
} as UserConfig);
