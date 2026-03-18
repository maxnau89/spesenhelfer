import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE_PATH || "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        authPopup: path.resolve(__dirname, "auth-popup.html"),
      },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL || "http://localhost:8011",
        changeOrigin: true,
      },
      "/health": {
        target: process.env.VITE_API_BASE_URL || "http://localhost:8011",
        changeOrigin: true,
      },
    },
  },
});
