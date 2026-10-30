import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import UnoCSS from "unocss/vite";
import path from "node:path";

export default defineConfig({
  base: "/static/",
  plugins: [UnoCSS(), svelte()],
  build: {
    // 输出到 server.mjs 的 STATIC_DIR；必须允许清空（outDir 在 root 之外）
    outDir: path.resolve(import.meta.dirname, "../static"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, "index.html"),
    },
  },
  server: {
    proxy: {
      // 开发时前端跑在 5173，API/SSE 转发给本机 portal 服务
      "/api": { target: "http://localhost:9900", changeOrigin: false },
    },
  },
});
