// Copies the PGlite browser build into /public so the SQL labs can load a real
// PostgreSQL (compiled to WebAssembly) from our own origin, without routing the
// WASM through the bundler.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "@electric-sql", "pglite", "dist");
const dest = join(root, "public", "vendor", "pglite");

if (!existsSync(src)) {
  console.warn("[copy-pglite] @electric-sql/pglite not installed; SQL labs will be unavailable.");
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, {
  recursive: true,
  filter: (p) => !p.endsWith(".map") && !p.endsWith(".d.ts") && !p.endsWith(".cjs"),
});
console.log("[copy-pglite] copied PGlite dist to public/vendor/pglite");
