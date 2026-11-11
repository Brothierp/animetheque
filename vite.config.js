import { defineConfig } from "vite";
import { resolve } from "node:path";

// Deux pages : le catalogue (index.html) et « Mon compte » (compte.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        compte: resolve(import.meta.dirname, "compte.html")
      }
    }
  }
});
