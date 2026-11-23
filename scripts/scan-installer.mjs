#!/usr/bin/env node
/**
 * Antes de publicar: busca términos personales dentro de lo que se empaqueta, en UTF-8 y en UTF-16 (Windows
 * guarda así muchas cadenas). La lista vive fuera del repo, en el PC de quien publica.
 *
 *   node scripts/scan-installer.mjs --terms <archivo> [--except "A,B"] [carpeta]     por defecto, release/win-unpacked
 *
 * `--except`: términos que no se buscan, como nombres comunes que vienen en los binarios de Electron (los datos
 * de idiomas de Chromium traen nombres de personas). Sale con código 1 si encuentra algo.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const at = args.indexOf("--terms");
if (at < 0 || !args[at + 1]) {
  console.error("Falta --terms <archivo>, con un término personal por línea.");
  process.exit(2);
}
const ex = args.indexOf("--except");
const except = new Set(
  (ex >= 0 ? (args[ex + 1] ?? "") : "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean),
);
const terms = readFileSync(args[at + 1], "utf8")
  .split(/\r?\n/)
  .map((t) => t.trim())
  .filter((t) => t && !except.has(t.toLowerCase()));
// Lo que queda, sacando las opciones y sus valores, es la carpeta.
const used = new Set([at, at + 1, ...(ex >= 0 ? [ex, ex + 1] : [])]);
const rest = args.filter((_, i) => !used.has(i));
const root = resolve(rest[0] ?? "release/win-unpacked");

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

let files;
try {
  files = statSync(root).isDirectory() ? walk(root) : [root];
} catch {
  console.error(`No existe ${root}. ¿Corriste npm run dist?`);
  process.exit(2);
}

let hits = 0;
for (const file of files) {
  const buf = readFileSync(file);
  for (const enc of ["utf8", "utf16le"]) {
    for (const t of terms) {
      for (const variant of new Set([t, t.toLowerCase()])) {
        if (buf.indexOf(Buffer.from(variant, enc)) >= 0) {
          hits++;
          console.error(`${relative(root, file) || file} [${enc}] ${variant}`);
        }
      }
    }
  }
}
console.log(`Archivos: ${files.length}. Coincidencias: ${hits}.`);
process.exit(hits ? 1 : 0);
