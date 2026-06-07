import path from "path"
import tailwindcss from "@tailwindcss/vite";
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { defineConfig, UserConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
    build: {
      sourcemap: true,
    },
    plugins: [
      tailwindcss(),
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: false,
        routesDirectory: './routes',
        generatedRouteTree: './routeTree.gen.ts',
      }),
      react(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./")
      },
  },
} as UserConfig)
