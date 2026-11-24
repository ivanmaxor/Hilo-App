#!/usr/bin/env node
/**
 * Publica una versión en GitHub Releases: exactamente el instalador, su .blockmap, latest.yml y la firma
 * del instalador (#4, D36), que Hilo verifica antes de ofrecer instalar.
 *
 *   npm run dist
 *   node scripts/publish-release.mjs --key <clave privada> --dry-run   firma y comprueba todo, sin publicar
 *   node scripts/publish-release.mjs --key <clave privada>             publica
 *
 * La clave privada está en la carpeta privada del dueño, nunca en el repo (también sirve HILO_UPDATE_KEY).
 * Opciones: --release-dir <carpeta> (por defecto release/), --notes-file <archivo>, --prerelease.
 * Una versión de prueba (x.y.z-rc.N) va con --prerelease: el actualizador de la gente no la ofrece ni la
 * instala (allowPrerelease = false e isStableVersion).
 * No sube código: el tag apunta al último commit del repo público, que debe tener al menos uno.
 * GitHub le agrega por su cuenta el zip de ese contenido.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUpdateTarget } from './update-target.cjs';
import { signRelease } from './update-signature.mjs';

const { owner, repo } = readUpdateTarget();
const SLUG = `${owner}/${repo}`;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const releaseDir = resolve(option('--release-dir') ?? join(root, 'release'));
const notesFile = option('--notes-file');
const prerelease = args.includes('--prerelease');

function fail(message) {
  console.error(`No se publica. ${message}`);
  process.exit(1);
}

function run(command, commandArgs) {
  const r = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (r.error) fail(`No se pudo ejecutar ${command}: ${r.error.message}`);
  return r;
}

const ymlField = (yml, name) => new RegExp(`^${name}:\\s*['"]?(.*?)['"]?\\s*$`, 'm').exec(yml)?.[1];

// Primero lo local: lo que se va a subir tiene que ser coherente.
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const tag = `v${version}`;
const isPre = version.includes('-');
if (isPre && !prerelease) fail(`${version} es una versión de prueba: publícala con --prerelease, así no les llega a los usuarios.`);
if (!isPre && prerelease) fail(`--prerelease es para versiones de prueba (x.y.z-rc.N), y package.json dice ${version}.`);
const installer = `Hilo-Setup-${version}.exe`;
const files = [installer, `${installer}.blockmap`, 'latest.yml'].map((f) => join(releaseDir, f));
for (const file of files) {
  if (!existsSync(file)) fail(`Falta ${file}. ¿Corriste npm run dist con la versión ${version}?`);
}

const yml = readFileSync(join(releaseDir, 'latest.yml'), 'utf8');
if (ymlField(yml, 'version') !== version) fail(`latest.yml es de la versión ${ymlField(yml, 'version')} y package.json dice ${version}.`);
if (ymlField(yml, 'path') !== installer) fail(`latest.yml apunta a "${ymlField(yml, 'path')}" y el instalador es "${installer}".`);
const hash = createHash('sha512').update(readFileSync(files[0])).digest('base64');
if (ymlField(yml, 'sha512') !== hash) fail(`El sha512 de latest.yml no coincide con ${installer}: las actualizaciones lo rechazarían.`);

// La firma (#4, D36): desde la 1.4.0, Hilo no instala una versión sin ella.
const keyFile = option('--key') ?? process.env.HILO_UPDATE_KEY;
if (!keyFile) fail('Falta la clave para firmar: --key <archivo .pem>. Está en la carpeta privada del dueño, nunca en el repo.');
if (!existsSync(keyFile)) fail(`No está la clave ${keyFile}.`);
let signature;
try {
  signature = signRelease({ keyFile, version, fileName: installer, sha512: hash });
} catch (error) {
  fail(`No se pudo firmar: ${error.message}.`);
}
const signatureFile = join(releaseDir, `${installer}.sig`);
writeFileSync(signatureFile, `${signature}\n`);
files.push(signatureFile);

// Lo publicado tiene que salir de un commit, no de cambios a medias.
const status = run('git', ['status', '--porcelain']);
if (status.status !== 0) fail(`git status falló: ${status.stderr.trim()}`);
if (status.stdout.trim()) fail(`El árbol de git no está limpio:\n${status.stdout}`);

// Después lo remoto, solo leyendo.
const commits = run('gh', ['api', `repos/${SLUG}/commits?per_page=1`]);
if (commits.status !== 0) {
  if (/empty/i.test(commits.stderr + commits.stdout)) fail(`${SLUG} está vacío y GitHub no crea versiones en un repo sin commits. Sube antes un commit con el README.`);
  fail(`No se pudo leer ${SLUG}: ${commits.stderr.trim()}`);
}
const tagRef = run('gh', ['api', `repos/${SLUG}/git/ref/tags/${tag}`]);
if (tagRef.status === 0) fail(`El tag ${tag} ya existe en ${SLUG}.`);
if (!/404/.test(tagRef.stderr + tagRef.stdout)) fail(`No se pudo comprobar el tag ${tag}: ${tagRef.stderr.trim()}`);

const notes = notesFile ? ['--notes-file', notesFile] : ['--notes', `Hilo ${version}. Para instalar, baja ${installer}. Si ya tienes Hilo, se actualiza desde Ajustes.`];
const create = ['release', 'create', tag, ...files, '--repo', SLUG, '--title', `Hilo ${version}`, ...(prerelease ? ['--prerelease', '--latest=false'] : ['--latest']), ...notes];

if (dryRun) {
  console.log('Todo en orden. Sin --dry-run se ejecutaría:\n');
  console.log(`gh ${create.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
  process.exit(0);
}

const published = spawnSync('gh', create, { cwd: root, stdio: 'inherit', windowsHide: true });
if (published.status !== 0) fail('gh release create falló.');
