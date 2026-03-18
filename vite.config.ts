import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],

  // Prevent vite from obscuring Rust errors
  clearScreen: false,

  // Use relative paths so assets load correctly under Tauri's custom protocol
  base: "./",

  // Tauri expects a fixed port; fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  // Produce Tauri-compatible output
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});