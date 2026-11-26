import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), nodePolyfills({ include: ["buffer", "process", "crypto", "stream", "util"] })],
  server: { port: 5173, host: true },
});
