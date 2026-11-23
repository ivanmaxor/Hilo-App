#!/usr/bin/env node
/**
 * Busca en el repo lo que nunca debe publicarse: correos personales, rutas con un nombre de usuario de
 * Windows y claves. Lo corre el CI en cada PR, y cada persona puede sumarle su propia lista de términos
 * personales, que vive fuera del repo.
 *
 *   node scripts/check-privacy.mjs                     todos los archivos que sigue git
 *   node scripts/check-privacy.mjs --staged            solo lo que va en el próximo commit (para un hook pre-commit)
 *   node scripts/check-privacy.mjs --terms <archivo>   además, un término personal por línea
 *
 * Sale con código 1 si encuentra algo.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const staged = args.includes("--staged");
const termsAt = args.indexOf("--terms");
const termsFile = termsAt >= 0 ? args[termsAt + 1] : null;
const SELF = "scripts/check-privacy.mjs";
/** Metadatos de terceros: los correos de los autores de los paquetes no son nuestros. */
const SKIP = new Set([SELF, "package-lock.json"]);

const git = (...a) => execFileSync("git", a, { maxBuffer: 256 * 1024 * 1024 });

const files = (
  staged
    ? git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    : git("ls-files", "-z")
)
  .toString()
  .split("\0")
  .filter((f) => f && !SKIP.has(f));

const terms = termsFile
  ? readFileSync(termsFile, "utf8")
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
  : [];

/** Correos que sí pueden aparecer: noreply, ejemplos y los de proyectos de terceros. */
const ALLOWED_EMAIL = [
  /@users\.noreply\.github\.com$/i,
  /^noreply@/i,
  /@example\.(com|org|net)$/i,
  // .invalid es un dominio reservado: nunca es un correo real.
  /\.invalid$/i,
  /^git@github\.com$/i,
];
/** Nombres de usuario de Windows que son de ejemplo. */
const ALLOWED_USER = new Set([
  "dev",
  "x",
  "usuario",
  "user",
  "name",
  "public",
  "default",
  "runneradmin",
  "<usuario>",
  "%username%",
]);

// Se arman por partes para que este archivo no se encuentre a sí mismo.
const SECRETS = [
  [
    "token de GitHub",
    new RegExp(
      "\\b(gh" + "[pousr]_[A-Za-z0-9]{30,}|github_" + "pat_[A-Za-z0-9_]{30,})",
    ),
  ],
  ["clave de Anthropic", new RegExp("sk-" + "ant-[A-Za-z0-9_-]{20,}")],
  ["clave de AWS", new RegExp("\\bAK" + "IA[0-9A-Z]{16}\\b")],
  ["clave privada", new RegExp("-----BEGIN [A-Z ]*PRIVATE " + "KEY-----")],
  ["token de Slack", new RegExp("\\bxox" + "[baprs]-[A-Za-z0-9-]{10,}")],
];

const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const USER_PATH =
  /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/c\/Users\/|C--Users-)([^\\/\s"'`<>:|*?-]+)/gi;

const found = [];
for (const file of files) {
  let buf;
  try {
    buf = staged ? git("show", `:${file}`) : readFileSync(file);
  } catch {
    continue;
  }
  if (buf.length > 8 * 1024 * 1024 || buf.includes(0)) continue;
  const lines = buf.toString("utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const m of line.matchAll(EMAIL)) {
      // usuario:clave@host dentro de una URL no es un correo.
      if (line[m.index - 1] === ":") continue;
      const email = m[0].replace(/\.+$/, "");
      if (!ALLOWED_EMAIL.some((re) => re.test(email)))
        found.push(`${at}  correo: ${email}`);
    }
    for (const m of line.matchAll(USER_PATH)) {
      if (!ALLOWED_USER.has(m[1].toLowerCase()))
        found.push(`${at}  ruta con un usuario de Windows: ${m[0]}`);
    }
    for (const [name, re] of SECRETS)
      if (re.test(line)) found.push(`${at}  posible ${name}`);
    const lower = line.toLowerCase();
    for (const t of terms)
      if (lower.includes(t.toLowerCase()))
        found.push(`${at}  término personal: ${t}`);
  });
}

if (found.length) {
  console.error(
    `Privacidad: ${found.length} problema(s). Nada de esto puede publicarse:\n`,
  );
  for (const f of found) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  `Privacidad: ${files.length} archivo(s) revisados${terms.length ? `, con ${terms.length} términos personales` : ""}, sin problemas.`,
);
