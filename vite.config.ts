import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: { "/api": process.env.GEOCROP_API || "http://127.0.0.1:8000" },
  },
});
