import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], server: { hmr: { port: 24751 } }, build: { target: "es2022" } });
