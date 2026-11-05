// El dueño y el repo de las actualizaciones están solo en `publish`, en electron-builder.yml.
// De aquí los toman la compilación (van fijos en la app) y scripts/publish-release.mjs.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

function parseUpdateTarget(yml) {
  const block = /^publish:[ \t]*\r?\n((?:[ \t]+.*(?:\r?\n|$))+)/m.exec(yml)?.[1] ?? '';
  const field = (name) => new RegExp(`^[ \\t]+${name}:[ \\t]*['"]?([\\w.-]+)['"]?[ \\t]*\\r?$`, 'm').exec(block)?.[1];
  const [provider, owner, repo] = [field('provider'), field('owner'), field('repo')];
  if (provider !== 'github' || !owner || !repo) throw new Error('electron-builder.yml: `publish` tiene que traer provider: github, owner y repo.');
  return { owner, repo };
}

function readUpdateTarget() {
  return parseUpdateTarget(readFileSync(join(__dirname, '..', 'electron-builder.yml'), 'utf8'));
}

module.exports = { parseUpdateTarget, readUpdateTarget };
