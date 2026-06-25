import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      // koffi ships prebuilt .node binaries and must NOT be bundled by Vite.
      // It is require()'d at runtime from node_modules instead.
      external: ["koffi"],
    },
  },
  server: {
    watch: {
      ignored: ["**/src-native/**"],
    },
  },
});
