import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      // koffi ships prebuilt .node binaries and must NOT be bundled by Vite.
      // It is require()'d at runtime from node_modules instead.
      external: [
        "koffi",
        // @twurple packages — ESM-only, cannot be bundled by Rolldown into CJS.
        // Dynamic import() is used in main.ts; these are resolved at runtime from node_modules.
        "@twurple/auth",
        "@twurple/api",
        "@twurple/api-call",
        "@twurple/common",
        "@twurple/eventsub-ws",
        "@twurple/eventsub-base",
        // @d-fischer packages — transitive deps of @twurple, also ESM-only
        "@d-fischer/cache-decorators",
        "@d-fischer/connection",
        "@d-fischer/detect-node",
        "@d-fischer/isomorphic-ws",
        "@d-fischer/logger",
        "@d-fischer/rate-limiter",
        "@d-fischer/shared-utils",
        "@d-fischer/typed-event-emitter",
      ],
    },
  },
  server: {
    watch: {
      ignored: ["**/src-native/**"],
    },
  },
});
