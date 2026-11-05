import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUpdateTarget } from './update-target.cjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const prod = process.argv.includes('--prod');
const out = join(root, 'dist');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'renderer'), { recursive: true });

const common = {
  bundle: true,
  minify: prod,
  sourcemap: prod ? false : 'linked',
  logLevel: 'warning',
  legalComments: 'none',
  absWorkingDir: root,
  define: { __HILO_UPDATE_TARGET__: JSON.stringify(readUpdateTarget()) },
};

await build({
  ...common,
  entryPoints: { index: 'src/main/index.ts', conoutWorker: 'src/main/pty/conoutWorker.ts' },
  outdir: 'dist/main',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron', 'node-pty', 'node-pty/*'],
});

await build({
  ...common,
  entryPoints: { index: 'src/preload/index.ts' },
  outdir: 'dist/preload',
  platform: 'node',
  target: 'chrome130',
  format: 'cjs',
  external: ['electron'],
});

await build({
  ...common,
  entryPoints: { app: 'src/renderer/main.tsx' },
  outdir: 'dist/renderer',
  platform: 'browser',
  target: 'chrome130',
  format: 'iife',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  external: ['/fonts/*'],
});

// conpty.node con el arreglo de concurrencia (docs/DECISIONES.md, D7), en lugar del que trae node-pty.
const CONPTY_SHA256 = '1269fe566ec416e7ea9720ced9401466d7651f7a87c901e107f6457ef4b2927c';
const vendored = join(root, 'vendor/node-pty/conpty.node');
if (createHash('sha256').update(readFileSync(vendored)).digest('hex') !== CONPTY_SHA256) {
  throw new Error('vendor/node-pty/conpty.node no coincide con el hash esperado. Ver scripts/build-conpty.mjs.');
}
cpSync(vendored, join(root, 'node_modules/node-pty/prebuilds/win32-x64/conpty.node'));

cpSync(join(root, 'src/renderer/index.html'), join(out, 'renderer/index.html'));
cpSync(join(root, 'assets/fonts'), join(out, 'renderer/fonts'), { recursive: true });
console.log(`Listo: dist/ (${prod ? 'producción' : 'desarrollo'})`);
