import { expect, test } from '@playwright/test';
import { buildSync } from 'esbuild';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { newDataDir, ROOT } from './helpers';

/**
 * Contra el GitHub real, solo lecturas públicas: HILO_E2E_RED=1 npx playwright test tests/e2e/updates-red.spec.ts
 * Si GitHub cambia de host las descargas, esta prueba es la que avisa: ver UPDATE_HOSTS.
 */
test('la lista de hosts alcanza para la cadena real, y nada más pasa', async () => {
  test.skip(!process.env.HILO_E2E_RED, 'Definir HILO_E2E_RED=1: sale a internet');
  test.setTimeout(120_000);
  const dir = newDataDir();
  const out = join(dir, 'informe.json');
  const bundle = join(dir, 'net-check.cjs');
  const { readUpdateTarget } = require(join(ROOT, 'scripts/update-target.cjs'));
  buildSync({
    entryPoints: [join(ROOT, 'tests/fixtures/update-net-check.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: bundle,
    external: ['electron'],
    logLevel: 'error',
    define: { __HILO_UPDATE_TARGET__: JSON.stringify(readUpdateTarget()) },
  });
  const env: NodeJS.ProcessEnv = { ...process.env, HILO_NET_OUT: out, HILO_NET_DIR: dir, LOCALAPPDATA: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const electronExe = join(ROOT, 'node_modules/electron/dist/electron.exe');
  const child = spawn(electronExe, [bundle], { env, stdio: 'inherit' });
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const report = JSON.parse(readFileSync(out, 'utf8'));
  console.log(JSON.stringify(report, null, 2));
  try {
    expect(report.fatal).toBeUndefined();

    // El repo de Hilo responde con una versión, pasando solo por los dos hosts permitidos.
    expect(report.hilo.version).toMatch(/^\d+\.\d+\.\d+/);
    expect([...new Set(report.hiloHops.map((h: { host: string }) => h.host))].sort()).toEqual(['github.com', 'release-assets.githubusercontent.com']);

    // La cadena real llega al yml pasando por los dos hosts, y ninguno más.
    expect(report.chain.version).toMatch(/^\d+\.\d+\.\d+/);
    const hosts = new Set(report.chainHops.map((h: { host: string }) => h.host));
    expect([...hosts].sort()).toEqual(['github.com', 'release-assets.githubusercontent.com']);
    expect(report.sentHeaders).not.toContain('x-user-staging-id');
    expect(report.sentHeaders).not.toContain('cookie');
    expect(existsSync(report.updaterId)).toBe(false);

    for (const [url, result] of Object.entries(report.blocked)) expect(result, url).toContain('ERR_BLOCKED_BY_CLIENT');
    expect(report.allowed).toMatch(/^HTTP /);

    expect(report.dns['github.com']).toMatch(/^HTTP /);
    expect(report.dns['example.com']).toContain('ERR_NAME_NOT_RESOLVED');
    expect(report.dns['api.github.com']).toContain('ERR_NAME_NOT_RESOLVED');

    expect(report.defaultSession).toContain('ERR_BLOCKED_BY_CLIENT');
    expect(report.netDefault).toContain('ERR_BLOCKED_BY_CLIENT');
    expect(report.renderer).not.toBe('llegó');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
