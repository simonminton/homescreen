// Cache-busting stamper. Hashes the source and writes that hash into every
// `?v=` query (index.html assets + app.js lib imports) so a content change
// invalidates the browser cache automatically. Run: npm run stamp.
//
// Deterministic: existing ?v= tokens are stripped before hashing, so re-running
// without a real change is a no-op.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const strip = (s) => s.replace(/\?v=[\w]+/g, "");

const libFiles = readdirSync("lib").filter((f) => f.endsWith(".js")).sort();
const sources = ["app.js", "style.css", "index.html", ...libFiles.map((f) => `lib/${f}`)];

const hash = createHash("sha256");
for (const f of sources) hash.update(f + "\0" + strip(readFileSync(f, "utf8")));
const v = hash.digest("hex").slice(0, 8);

// index.html: stamp local .css / .js assets only (skips data: URIs and CDN fonts).
const html = strip(readFileSync("index.html", "utf8"))
  .replace(/(href|src)="([^"]+\.(?:css|js))"/g, `$1="$2?v=${v}"`);
writeFileSync("index.html", html);

// app.js: stamp the ./lib/* import specifiers.
const app = readFileSync("app.js", "utf8")
  .replace(/from "(\.\/lib\/[\w.]+?)(?:\?v=[\w]+)?"/g, `from "$1?v=${v}"`);
writeFileSync("app.js", app);

console.log(`Stamped v=${v} across ${sources.length} source files.`);
