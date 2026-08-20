import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Bound to 0.0.0.0 so the dev server is reachable over Tailscale.
// /api is proxied to the FastAPI gateway so the browser only ever talks to
// one origin, in dev and in prod alike.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
        // SSE must not be buffered by the proxy.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
            }
          });
        },
      },
    },
  },
});
