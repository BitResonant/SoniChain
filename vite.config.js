import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { copyFileSync } from "fs";
import { resolve } from "path";

const DSP_SRC = resolve("src/RNBO/DSP.json");
const DSP_DEST = resolve("static/DSP.export.json");

function syncDspPlugin() {
  return {
    name: "sync-dsp",
    buildStart() {
      copyFileSync(DSP_SRC, DSP_DEST);
    },
    configureServer(server) {
      server.watcher.add(DSP_SRC);
      server.watcher.on("change", (file) => {
        if (file === DSP_SRC) {
          copyFileSync(DSP_SRC, DSP_DEST);
          server.ws.send({ type: "full-reload" });
        }
      });
    },
  };
}

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit(), syncDspPlugin()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
