#!/usr/bin/env node
/**
 * Borrador de las novedades de la próxima versión: los PR fusionados desde la última versión publicada,
 * con su número y autor. Sirve para escribir la entrada de src/shared/changelog.ts, que es lo que ve la
 * gente: este texto no se publica tal cual.
 *
 *   node scripts/novedades.mjs
 */
import { execFileSync } from "node:child_process";

const run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

let since = "";
try {
  const tag = run("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"]);
  since = run("git", ["log", "-1", "--format=%cI", tag]);
  console.log(`Desde ${tag} (${since.slice(0, 10)}):\n`);
} catch {
  console.log("No hay versiones publicadas: van todos los PR fusionados.\n");
}

const query = since ? `merged:>${since}` : "";
const prs = JSON.parse(
  run("gh", [
    "pr",
    "list",
    "--state",
    "merged",
    "--base",
    "main",
    "--limit",
    "200",
    "--search",
    query,
    "--json",
    "number,title,author,labels",
  ]),
);
if (!prs.length) {
  console.log("Ningún PR fusionado todavía.");
  process.exit(0);
}
for (const pr of prs.reverse()) {
  const labels = pr.labels.map((l) => l.name).join(", ");
  console.log(
    `- ${pr.title} (#${pr.number}, @${pr.author.login}${labels ? `; ${labels}` : ""})`,
  );
}
