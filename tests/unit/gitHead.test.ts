import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_BRANCH_CHARS, readBranch, type GitHeadFs } from '../../src/shared/gitHead';
import { branchOf } from '../../src/main/git';

/** Un disco falso: `files` con su texto (o 'link' para un enlace) y `dirs` con sus carpetas. */
function fakeDisk(files: Record<string, string | 'LINK'>, dirs: string[] = []): GitHeadFs & { reads: string[] } {
  const norm = (p: string) => win32.normalize(p).toLowerCase();
  const f = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]));
  const d = new Set(dirs.map(norm));
  const reads: string[] = [];
  return {
    reads,
    async lstat(path) {
      const key = norm(path);
      reads.push(key);
      const file = f.get(key);
      if (file === 'LINK') return { file: false, dir: false, link: true };
      if (file !== undefined) return { file: true, dir: false, link: false };
      if (d.has(key)) return { file: false, dir: true, link: false };
      return null;
    },
    async readText(path, max) {
      const text = f.get(norm(path));
      if (text === undefined || text === 'LINK') return null;
      return Buffer.byteLength(text) > max ? null : text;
    },
  };
}

const repo = (head: string, extra: Record<string, string | 'LINK'> = {}) =>
  fakeDisk({ 'C:\\repo\\.git\\HEAD': head, ...extra }, ['C:\\repo\\.git']);

describe('readBranch', () => {
  it('lee la rama de HEAD', async () => {
    expect(await readBranch('C:\\repo', repo('ref: refs/heads/main\n'))).toEqual({ kind: 'branch', name: 'main' });
  });

  it('tolera CRLF y BOM', async () => {
    expect(await readBranch('C:\\repo', repo('\ufeffref: refs/heads/main\r\n'))).toEqual({ kind: 'branch', name: 'main' });
  });

  it('conserva las barras de la rama', async () => {
    expect(await readBranch('C:\\repo', repo('ref: refs/heads/feature/x/y\n'))).toEqual({ kind: 'branch', name: 'feature/x/y' });
  });

  it('un hash de 40 es un commit suelto: primeros 7', async () => {
    const hash = 'ABCDEF0123456789abcdef0123456789abcdef01';
    expect(await readBranch('C:\\repo', repo(`${hash}\n`))).toEqual({ kind: 'detached', name: 'abcdef0' });
  });

  it('un hash SHA-256 de 64 también', async () => {
    expect(await readBranch('C:\\repo', repo(`${'a1'.repeat(32)}\n`))).toEqual({ kind: 'detached', name: 'a1a1a1a' });
  });

  it('un repositorio sin commits ya tiene rama', async () => {
    expect(await readBranch('C:\\repo', repo('ref: refs/heads/master\n'))).toEqual({ kind: 'branch', name: 'master' });
  });

  it('sube desde una subcarpeta hasta el repositorio', async () => {
    expect(await readBranch('C:\\repo\\a\\b\\c', repo('ref: refs/heads/dev\n'))).toEqual({ kind: 'branch', name: 'dev' });
  });

  it('con `.git` como archivo (worktree), ruta relativa', async () => {
    const disk = fakeDisk({
      'C:\\work\\wt\\.git': 'gitdir: ../main/.git/worktrees/wt\n',
      'C:\\work\\main\\.git\\worktrees\\wt\\HEAD': 'ref: refs/heads/otra\n',
    });
    expect(await readBranch('C:\\work\\wt\\src', disk)).toEqual({ kind: 'branch', name: 'otra' });
  });

  it('con `.git` como archivo, ruta absoluta de Windows (submódulo)', async () => {
    const disk = fakeDisk({
      'C:\\work\\sub\\.git': 'gitdir: C:/work/main/.git/modules/sub\r\n',
      'C:\\work\\main\\.git\\modules\\sub\\HEAD': 'ref: refs/heads/sm\n',
    });
    expect(await readBranch('C:\\work\\sub', disk)).toEqual({ kind: 'branch', name: 'sm' });
  });

  it('sin git llega a la raíz y no muestra nada', async () => {
    const disk = fakeDisk({});
    expect(await readBranch('C:\\no\\hay\\repo', disk)).toBeNull();
    expect(disk.reads.length).toBeLessThanOrEqual(5);
  });

  it('no sube más de 40 niveles', async () => {
    const disk = fakeDisk({});
    await readBranch(`C:\\${Array.from({ length: 80 }, (_, i) => `d${i}`).join('\\')}`, disk);
    expect(disk.reads.length).toBeLessThanOrEqual(40);
  });

  it('un HEAD de 5 KB o con basura no muestra nada', async () => {
    expect(await readBranch('C:\\repo', repo(`ref: refs/heads/${'x'.repeat(5000)}\n`))).toBeNull();
    expect(await readBranch('C:\\repo', repo('esto no es un HEAD'))).toBeNull();
    expect(await readBranch('C:\\repo', repo(''))).toBeNull();
    expect(await readBranch('C:\\repo', repo('ref: refs/heads/a\nrefs/heads/b\n'))).toBeNull();
    expect(await readBranch('C:\\repo', repo('ref: refs/remotes/origin/main\n'))).toBeNull();
  });

  it('un `.git` enlace, un gitdir sin HEAD o un HEAD enlace no muestran nada', async () => {
    expect(await readBranch('C:\\repo', fakeDisk({ 'C:\\repo\\.git': 'LINK' }))).toBeNull();
    expect(await readBranch('C:\\repo', fakeDisk({ 'C:\\repo\\.git': 'gitdir: C:\\otro\\gitdir\n' }))).toBeNull();
    expect(await readBranch('C:\\repo', fakeDisk({ 'C:\\repo\\.git\\HEAD': 'LINK' }, ['C:\\repo\\.git']))).toBeNull();
    expect(await readBranch('C:\\repo', fakeDisk({}, ['C:\\repo\\.git']))).toBeNull();
  });

  it('una rama inválida o una ruta de red no muestran nada', async () => {
    expect(await readBranch('C:\\repo', repo('ref: refs/heads/.invalid\n'))).toBeNull();
    expect(await readBranch('C:\\repo', repo('ref: refs/heads/a..b\n'))).toBeNull();
    expect(await readBranch('\\\\srv\\share\\repo', fakeDisk({ '\\\\srv\\share\\repo\\.git\\HEAD': 'ref: refs/heads/x\n' }, ['\\\\srv\\share\\repo\\.git']))).toBeNull();
    expect(await readBranch('relativa\\carpeta', repo('ref: refs/heads/x\n'))).toBeNull();
    // Un gitdir que apunta a la red tampoco se sigue.
    expect(await readBranch('C:\\repo', fakeDisk({ 'C:\\repo\\.git': 'gitdir: \\\\srv\\share\\x\n', '\\\\srv\\share\\x\\HEAD': 'ref: refs/heads/x\n' }))).toBeNull();
  });

  it('limpia caracteres de control y limita el largo', async () => {
    expect(await readBranch('C:\\repo', repo('ref: refs/heads/ab\u202ecd\u0007ef\n'))).toEqual({ kind: 'branch', name: 'abcdef' });
    const long = await readBranch('C:\\repo', repo(`ref: refs/heads/${'ñ'.repeat(100)}\n`));
    expect(Array.from(long!.name).length).toBe(MAX_BRANCH_CHARS);
    expect(long!.name.endsWith('…')).toBe(true);
  });

  it('se detiene si lo cancelan', async () => {
    expect(await readBranch('C:\\repo', repo('ref: refs/heads/main\n'), { cancelled: () => true })).toBeNull();
  });
});

describe('branchOf con el disco real', () => {
  const root = mkdtempSync(join(tmpdir(), 'hilo-head-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('un repositorio, un worktree y una carpeta sin git', async () => {
    const main = join(root, 'main');
    mkdirSync(join(main, '.git', 'worktrees', 'wt'), { recursive: true });
    mkdirSync(join(main, 'sub', 'deep'), { recursive: true });
    writeFileSync(join(main, '.git', 'HEAD'), 'ref: refs/heads/principal\n');
    writeFileSync(join(main, '.git', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/rama/del/worktree\n');
    const wt = join(root, 'wt');
    mkdirSync(wt);
    writeFileSync(join(wt, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n`);
    const big = join(root, 'big');
    mkdirSync(join(big, '.git'), { recursive: true });
    writeFileSync(join(big, '.git', 'HEAD'), `ref: refs/heads/${'y'.repeat(2000)}\n`);

    expect(await branchOf(join(main, 'sub', 'deep'))).toEqual({ kind: 'branch', name: 'principal' });
    expect(await branchOf(wt)).toEqual({ kind: 'branch', name: 'rama/del/worktree' });
    expect(await branchOf(big)).toBeNull();
    expect(await branchOf(join(root, 'no-existe'))).toBeNull();
    expect(await branchOf('\\\\servidor\\recurso\\repo')).toBeNull();

    // Un cambio de rama se ve de inmediato en un repositorio que ya se leyó bien.
    writeFileSync(join(main, '.git', 'HEAD'), 'ref: refs/heads/otra\n');
    expect(await branchOf(main)).toEqual({ kind: 'branch', name: 'otra' });
  });
});
