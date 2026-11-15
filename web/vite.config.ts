import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { networkInterfaces } from "node:os";

/** This Mac's Wi-Fi/LAN address, so a phone can reach the dev server from the QR code. */
function lanIp() {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) if (n.family === "IPv4" && !n.internal) return n.address;
  }
  return "localhost";
}

export default defineConfig({
  plugins: [
    react(),
    {
      // The Mac's address can change while the dev server runs (Wi-Fi hands out a new one),
      // so the TV asks for it at load time instead of trusting the one from startup.
      name: "lan-ip",
      configureServer(server) {
        server.middlewares.use("/lan-ip", (_req, res) => {
          res.setHeader("Content-Type", "text/plain");
          res.setHeader("Cache-Control", "no-store");
          res.end(lanIp());
        });
      },
    },
  ],
  define: {
    __LAN_IP__: JSON.stringify(lanIp()),
  },
  server: {
    host: true, // listen on the LAN too, not just localhost (the QR points phones at the LAN IP)
    port: 5173,
    strictPort: true,
    allowedHosts: [".trycloudflare.com"],
    proxy: {
      "/ws": { target: "ws://localhost:8000", ws: true },
      "/api": { target: "http://localhost:8000" },
      "/voice": { target: "http://127.0.0.1:8000" },
    },
  },
});
