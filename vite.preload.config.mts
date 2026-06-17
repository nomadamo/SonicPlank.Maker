import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    // Generates separate .js.map files instead of using eval
    sourcemap: true,
    // Prevents Vite from minifying code during local development
    minify: false,
  },
});
