import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';
import { describeUpdateError, isAllowedUpdateUrl, isStableVersion, resolverRules, resolveUpdateMode, RELEASES_URL, UPDATE_HOSTS, type UpdateMode } from '../../src/shared/updates';
import { sanitizeSettings } from '../../src/shared/validate';

const ROOT = join(__dirname, '..', '..');
const { parseUpdateTarget, readUpdateTarget } = createRequire(import.meta.url)(join(ROOT, 'scripts/update-target.cjs'));
const github: UpdateMode = { kind: 'github' };
const FEED = 'http://127.0.0.1:4567/';
const local: UpdateMode = { kind: 'local', feed: FEED, host: '127.0.0.1:4567' };

describe('de dónde se actualiza', () => {
  it('solo el empaquetado normal va a GitHub', () => {
    expect(resolveUpdateMode({ isPackaged: true, isTest: false })).toEqual(github);
    expect(resolveUpdateMode({ isPackaged: false, isTest: false })).toEqual({ kind: 'off' });
    expect(resolveUpdateMode({ isPackaged: false, isTest: true })).toEqual({ kind: 'off' });
    expect(resolveUpdateMode({ isPackaged: true, isTest: true })).toEqual({ kind: 'off' });
  });

  it('sin HILO_E2E=1 las variables de prueba no cambian nada', () => {
    expect(resolveUpdateMode({ isPackaged: true, isTest: false, testFeed: FEED })).toEqual(github);
    expect(resolveUpdateMode({ isPackaged: false, isTest: false, testFeed: FEED, testReal: '1' })).toEqual({ kind: 'off' });
  });

  it('en desarrollo nada sale a GitHub, ni pidiéndolo', () => {
    expect(resolveUpdateMode({ isPackaged: false, isTest: true, testReal: '1' })).toEqual({ kind: 'off' });
    expect(resolveUpdateMode({ isPackaged: true, isTest: true, testReal: '1' })).toEqual(github);
  });

  it('el feed de prueba solo puede ser de esta máquina', () => {
    expect(resolveUpdateMode({ isPackaged: false, isTest: true, testFeed: FEED })).toEqual(local);
    for (const testFeed of ['https://example.com/', 'http://localhost:4567/', 'http://127.0.0.1.example.com:80/', 'http://127.0.0.1:4567/x/', 'http://user@127.0.0.1:4567/', 'https://127.0.0.1:4567/', '']) {
      expect(resolveUpdateMode({ isPackaged: false, isTest: true, testFeed })).toEqual({ kind: 'off' });
    }
  });

  it('el DNS sigue cortado, salvo la lista exacta', () => {
    expect(resolverRules({ kind: 'off' })).toBe('MAP * ~NOTFOUND');
    expect(resolverRules(github)).toBe('MAP * ~NOTFOUND, EXCLUDE github.com, EXCLUDE release-assets.githubusercontent.com');
    expect(resolverRules(local)).toBe('MAP * ~NOTFOUND, EXCLUDE 127.0.0.1');
  });
});

describe('qué URL puede pedir el actualizador', () => {
  it('https a los hosts de la lista', () => {
    expect(UPDATE_HOSTS).toEqual(['github.com', 'release-assets.githubusercontent.com']);
    expect(isAllowedUpdateUrl(`${RELEASES_URL}.atom`, github)).toBe(true);
    expect(isAllowedUpdateUrl('https://github.com:443/a', github)).toBe(true);
    expect(isAllowedUpdateUrl('https://release-assets.githubusercontent.com/github-production-release-asset/1/2?sig=x', github)).toBe(true);
  });

  it.each([
    'http://github.com/a',
    'https://github.com:8443/a',
    'https://api.github.com/a',
    'https://gist.github.com/a',
    'https://objects.githubusercontent.com/a',
    'https://raw.githubusercontent.com/a',
    'https://github.com.example.com/a',
    'https://example.com/github.com',
    'https://github.com@example.com/a',
    'https://user:pass@github.com/a',
    'https://GITHUB.COM.example.com/',
    'file:///C:/Windows/notepad.exe',
    'ftp://github.com/a',
    'hilo://app/index.html',
    'no es una url',
    '',
  ])('rechaza %s', (url) => {
    expect(isAllowedUpdateUrl(url, github)).toBe(false);
  });

  it('en pruebas, solo ese servidor; apagado, nada', () => {
    expect(isAllowedUpdateUrl(`${FEED}latest.yml`, local)).toBe(true);
    expect(isAllowedUpdateUrl('http://127.0.0.1:9999/latest.yml', local)).toBe(false);
    expect(isAllowedUpdateUrl('https://127.0.0.1:4567/latest.yml', local)).toBe(false);
    expect(isAllowedUpdateUrl('https://github.com/a', local)).toBe(false);
    expect(isAllowedUpdateUrl('https://github.com/a', { kind: 'off' })).toBe(false);
  });
});

describe('versiones y mensajes', () => {
  it('sin prerreleases', () => {
    expect(isStableVersion('1.3.0')).toBe(true);
    for (const v of ['1.3.0-beta.1', '1.3', 'v1.3.0', '1.3.0+x', '', null, 1]) expect(isStableVersion(v)).toBe(false);
  });

  it.each([
    [new Error('net::ERR_INTERNET_DISCONNECTED'), 'No se pudo conectar'],
    [new Error('net::ERR_NAME_NOT_RESOLVED'), 'No se pudo conectar'],
    [new Error('net::ERR_CONNECTION_REFUSED'), 'No se pudo conectar'],
    [new Error('Unable to find latest version on GitHub (x), please ensure a production release exists: net::ERR_TIMED_OUT'), 'No se pudo conectar'],
    [new Error('net::ERR_BLOCKED_BY_CLIENT'), 'Hilo la bloqueó'],
    [new Error('net::ERR_CERT_AUTHORITY_INVALID'), 'comprobación de seguridad'],
    [new Error('sha512 checksum mismatch, expected a, got b'), 'no coincide con el publicado'],
    [new Error('New version 2.0.0 is not signed by the application owner: x'), 'no tiene la firma'],
    [new Error('No published versions on GitHub'), 'Todavía no hay versiones'],
    [new Error('Cannot find latest.yml in the latest release artifacts'), 'no trae el archivo'],
    [new Error('ENOSPC: no space left on device'), 'espacio'],
    [new Error('HttpError: 503 Service Unavailable'), 'código 503'],
    [new Error('cualquier otra cosa, con <xml> y rutas C:\\x'), 'No se pudo completar'],
    ['sin Error', 'No se pudo completar'],
  ])('%s', (error, expected) => {
    const text = describeUpdateError(error);
    expect(text).toContain(expected);
    expect(text).not.toContain('<xml>');
  });

  it('un estado sin el ajuste busca al abrir; un valor inválido no lo apaga', () => {
    expect(DEFAULT_SETTINGS.checkUpdatesOnStart).toBe(true);
    expect(sanitizeSettings({}).checkUpdatesOnStart).toBe(true);
    expect(sanitizeSettings({ checkUpdatesOnStart: 'no' }).checkUpdatesOnStart).toBe(true);
    expect(sanitizeSettings({ checkUpdatesOnStart: false }).checkUpdatesOnStart).toBe(false);
  });
});

describe('empaquetado', () => {
  const builder = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf8');
  const nsh = readFileSync(join(ROOT, 'assets/installer.nsh'), 'utf8');
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  it('un nombre sin espacios, y dist no sube nada', () => {
    expect(builder).toMatch(/artifactName: Hilo-Setup-\$\{version\}\.\$\{ext\}/);
    expect(pkg.scripts.dist).toContain('--publish never');
  });

  it('el dueño y el repo salen solo de electron-builder.yml', () => {
    const { owner, repo } = readUpdateTarget();
    expect(RELEASES_URL).toBe(`https://github.com/${owner}/${repo}/releases`);
    expect(builder).toContain(`repo: ${repo}`);
    for (const file of ['scripts/publish-release.mjs', 'src/main/updater.ts', 'src/shared/updates.ts']) {
      expect(readFileSync(join(ROOT, file), 'utf8'), file).not.toContain(repo);
    }
    expect(parseUpdateTarget('publish:\n  provider: github\n  owner: uno\n  repo: dos-tres.x\notro: 1\n')).toEqual({ owner: 'uno', repo: 'dos-tres.x' });
    expect(() => parseUpdateTarget('publish: null\n')).toThrow();
    expect(() => parseUpdateTarget('publish:\n  provider: generic\n  url: https://x/\n')).toThrow();
  });

  it('las versiones que deciden el formato de las actualizaciones están fijas', () => {
    expect(pkg.devDependencies['electron-updater']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies['electron-builder']).toMatch(/^26\.\d+\.\d+$/);
  });

  it('actualizar no borra el acceso directo ni la carpeta del instalador', () => {
    const body = /!macro customUnInstall([\s\S]*?)!macroend/.exec(nsh)![1]!;
    const guard = body.indexOf('${ifNot} ${isUpdated}');
    expect(guard).toBeGreaterThan(-1);
    for (const line of ['RMDir /r "$LOCALAPPDATA\\hilo-updater"', 'Delete "$DESKTOP\\${SHORTCUT_NAME}.lnk"']) {
      expect(body.indexOf(line)).toBeGreaterThan(guard);
      expect(body.indexOf(line)).toBeLessThan(body.indexOf('${endIf}'));
    }
  });

  it('actualizar no crea un acceso directo que la persona no quiso', () => {
    const body = /!macro customInstall\n([\s\S]*?)!macroend/.exec(nsh)![1]!;
    expect(body).toMatch(/\$\{if\} \$\{Silent\}\s+\$\{andIfNot\} \$\{isUpdated\}\s+Call CreateDesktopLink/);
  });
});

describe('scripts/publish-release.mjs, antes de tocar git o la red', () => {
  const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version as string;
  const run = (dir: string) => spawnSync(process.execPath, [join(ROOT, 'scripts/publish-release.mjs'), '--dry-run', '--release-dir', dir], { encoding: 'utf8', cwd: ROOT });

  function release(opts: { yml?: (exe: Buffer) => string; skip?: string } = {}): string {
    const dir = mkdtempSync(join(tmpdir(), 'hilo-release-'));
    const exe = Buffer.from('un instalador');
    const hash = createHash('sha512').update(exe).digest('base64');
    const name = `Hilo-Setup-${version}.exe`;
    if (opts.skip !== 'exe') writeFileSync(join(dir, name), exe);
    if (opts.skip !== 'blockmap') writeFileSync(join(dir, `${name}.blockmap`), 'x');
    if (opts.skip !== 'yml') writeFileSync(join(dir, 'latest.yml'), opts.yml ? opts.yml(exe) : `version: ${version}\npath: ${name}\nsha512: ${hash}\n`);
    return dir;
  }

  it.each([
    ['falta el instalador', { skip: 'exe' }, 'Falta'],
    ['falta el blockmap', { skip: 'blockmap' }, 'Falta'],
    ['falta latest.yml', { skip: 'yml' }, 'Falta'],
    ['otra versión en latest.yml', { yml: () => `version: 0.0.1\npath: Hilo-Setup-${version}.exe\nsha512: x\n` }, 'versión'],
    ['otro archivo en latest.yml', { yml: () => `version: ${version}\npath: Hilo Setup ${version}.exe\nsha512: x\n` }, 'apunta a'],
    ['otro hash en latest.yml', { yml: () => `version: ${version}\npath: Hilo-Setup-${version}.exe\nsha512: x\n` }, 'sha512'],
  ])('%s: no sigue', (_name, opts, expected) => {
    const dir = release(opts as Parameters<typeof release>[0]);
    try {
      const r = run(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
