import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

// BASELINE=1 builds the minimal React app (no Tailwind/UI libraries) used as the bundle-size reference.
const baseline = process.env.BASELINE === "1";
// ANALYZE=1 splits vendor code into one chunk per library, only to attribute bundle bytes.
const analyze = process.env.ANALYZE === "1";
const lib = (name: string, pattern: string, priority = 1) => ({
  name,
  test: new RegExp(`node_modules[\\\\/](?:\\.pnpm[\\\\/][^\\\\/]+[\\\\/]node_modules[\\\\/])?(?:${pattern})[\\\\/]`),
  priority,
});

export default defineConfig({
  root: baseline ? "baseline" : ".",
  plugins: baseline ? [react()] : [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  base: "./",
  build: {
    target: "es2022",
    sourcemap: false,
    assetsInlineLimit: 0,
    outDir: fileURLToPath(
      new URL(baseline ? "./dist/baseline" : analyze ? "./dist/analyze" : "./dist/app", import.meta.url),
    ),
    emptyOutDir: true,
    rolldownOptions: analyze
      ? {
          output: {
            codeSplitting: {
              groups: [
                lib("react", "react|react-dom|scheduler"),
                lib("base-ui", "@base-ui|@floating-ui|use-sync-external-store|reselect|@babel"),
                lib("dnd-kit", "@dnd-kit|tslib"),
                lib("react-resizable-panels", "react-resizable-panels"),
                lib("lucide-react", "lucide-react"),
                lib("cn-cva-clsx", "cn|class-variance-authority|clsx"),
              ],
            },
          },
        }
      : undefined,
  },
});
