import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Local dev: `npm run dev` with the API on :8000.
    proxy: { "/api": process.env.API_URL ?? "http://localhost:8000" },
  },
});
