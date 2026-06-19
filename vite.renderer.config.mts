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
    watch: {
      // encoder-config.json is a runtime tuning file written by Electron.
      // Vite must not watch it or every Apply/external edit triggers HMR.
      ignored: ["**/encoder-config.json"],
    },
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
