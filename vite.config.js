import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const stub = fileURLToPath(new URL("./src/stubs/nsfw-unused-model.js", import.meta.url));

export default defineConfig({
  resolve: {
    // seuls les poids du modèle MobileNetV2 de NSFWJS sont publiés
    alias: [{ find: /^\.\.\/model_imports\/(inception_v3|mobilenet_v2_mid)\.js$/, replacement: stub }],
  },
  build: { chunkSizeWarningLimit: 4000 },
});
