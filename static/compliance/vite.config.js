import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "" → relative asset paths so it loads inside the Forge full-page iframe
export default defineConfig({
  plugins: [react()],
  base: "",
  build: { outDir: "dist", emptyOutDir: true },
});
