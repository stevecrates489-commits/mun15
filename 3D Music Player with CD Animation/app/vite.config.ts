import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
server: {
    port: 3000,
    host: '127.0.0.1',
    // tauri.conf.json pins devUrl to :3000 — without strictPort Vite would
    // silently fall back to :3001 and the app window would load the wrong
    // server (or nothing). Fail loudly instead.
    strictPort: true,
    // pre-transform the whole app graph at startup, before the window ever
    // asks — first launch then serves warm modules instead of transforming
    // ~100 files on demand while the boot intro is already ticking
    warmup: {
      clientFiles: ["./src/**/*.{ts,tsx}"],
    },
    // cargo writes .exe files into src-tauri/target while tauri dev runs —
    // watching them makes chokidar throw EBUSY and kill the dev server
    watch: {
      ignored: ["**/node_modules/**", "**/.git/**", "**/src-tauri/**"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

