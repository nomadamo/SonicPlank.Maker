import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: true, // Add this line to enable debugging
  },
  server: {
    watch: {
      ignored: ["**/src-native/**"],
    },
  },
});
