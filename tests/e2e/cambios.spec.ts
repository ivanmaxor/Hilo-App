import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { changesPaneId } from '../../src/shared/paneContent';
import { cleanup, launch, makeState, settle, type Launched } from './helpers';

const [A, B] = ['a', 'b'].map((l) => `${l.repeat(8)}-5555-4000-8000-00000000000${l}`) as [string, string];
const CH = changesPaneId('proy');
/** Las capturas quedan aquí para mirarlas: fuera del repositorio. */
const SHOTS = process.env.HILO_SHOTS_DIR ?? join(tmpdir(), 'hilo-cambios-capturas');
mkdirSync(SHOTS, { recursive: true });

const CSC = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
let tools: string;
/** Un ejecutable que anota sus argumentos y sale. Hace de IDE: en estas pruebas nunca se abre uno de verdad. */
let fakeExe: string;
/** Anota cada llamada y pasa a git la misma línea de comandos, para ver qué se le pidió. */
let spyGit: string;
/** El de verdad, con ruta absoluta: un repositorio de estas pruebas trae su propio git.exe. */
let realGit: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync(realGit, ['-c', 'user.name=Hilo', '-c', 'user.email=hilo@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const lines = (n: number, tag = 'línea') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n';

function emptyRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hilo-repo-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'core.safecrlf', 'false');
  return dir;
}

function commitAll(dir: string): void {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicio');
}

/** Un repositorio con un cambio de cada tipo. */
function fullRepo(): string {
  const dir = emptyRepo();
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'App.java'), lines(60));
  writeFileSync(join(dir, 'borrar.txt'), lines(5, 'vieja'));
  writeFileSync(join(dir, 'viejo.txt'), lines(40, 'contenido'));
  writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1, 2, 3]));
  writeFileSync(join(dir, '.gitignore'), '*.log\n');
  commitAll(dir);
  const app = readFileSync(join(dir, 'src', 'App.java'), 'utf8').split('\n');
  app[2] = 'línea 3 cambiada';
  app.splice(40, 2, 'nueva A', 'nueva B', 'nueva C');
  writeFileSync(join(dir, 'src', 'App.java'), app.join('\n'));
  unlinkSync(join(dir, 'borrar.txt'));
  git(dir, 'mv', 'viejo.txt', 'renombrado.txt');
  writeFileSync(join(dir, 'renombrado.txt'), lines(40, 'contenido').replace('contenido 20\n', 'contenido veinte\n'));
  writeFileSync(join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 9, 9, 9, 9]));
  writeFileSync(join(dir, 'nuevo sin agregar.txt'), lines(4, 'fresca'));
  writeFileSync(join(dir, 'agregado.txt'), lines(2, 'puesta'));
  git(dir, 'add', 'agregado.txt');
  writeFileSync(join(dir, 'ruido.log'), 'esto está ignorado\n');
  return dir;
}

function stateFor(dir: string, extra: (s: ReturnType<typeof makeState>) => void = () => undefined) {
  const state = makeState([{ id: A, name: 'Uno' }, { id: B, name: 'Dos' }], dir);
  state.settings.wakeOnSelect = false;
  state.ui = { ...state.ui, activeSessionId: A, panes: [A], layout: 1, activePane: 0 };
  extra(state);
  return state;
}

const ui = (page: Page) => page.evaluate(() => (window as any).__hiloTest.app.get().state.ui);
const settings = (page: Page) => page.evaluate(() => (window as any).__hiloTest.app.get().state.settings);
const project = (page: Page) => page.evaluate(() => (window as any).__hiloTest.app.get().state.projects[0]);
const fileRow = (page: Page, path: string) => page.locator(`.cf-row[data-file="${path}"]`);
const openPanel = async (page: Page) => {
  await page.locator('[data-action="toggle-changes"]').click();
  await expect(page.locator('.changes')).toBeVisible();
  await expect(page.locator('.changes')).not.toHaveAttribute('data-status', 'loading');
};

test.beforeAll(() => {
  tools = mkdtempSync(join(tmpdir(), 'hilo-tools-'));
  const ide = join(tools, 'ide.cs');
  writeFileSync(
    ide,
    `using System;using System.IO;class P{static int Main(string[] a){File.AppendAllText(System.Reflection.Assembly.GetExecutingAssembly().Location+".log",string.Join("\\u0001",a)+"\\n");return 0;}}`,
  );
  fakeExe = join(tools, 'fake.exe');
  execFileSync(CSC, ['/nologo', '/target:winexe', `/out:${fakeExe}`, ide], { stdio: 'pipe' });
  realGit = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).split(/\r?\n/).find((l) => /git\.exe$/i.test(l.trim()))!.trim();
  const spy = join(tools, 'spy.cs');
  writeFileSync(
    spy,
    `using System;using System.Diagnostics;using System.IO;class P{static int Main(){
      string line=Environment.CommandLine;
      int at=line.StartsWith("\\"")?line.IndexOf('"',1)+1:line.IndexOf(' ');
      string rest=at<0||at>=line.Length?"":line.Substring(at).TrimStart();
      for(int t=0;t<200;t++){try{File.AppendAllText(System.Reflection.Assembly.GetExecutingAssembly().Location+".log",rest+"\\n");break;}catch(IOException){System.Threading.Thread.Sleep(5);}}
      var i=new ProcessStartInfo(@"${realGit}",rest);i.UseShellExecute=false;
      var p=Process.Start(i);p.WaitForExit();return p.ExitCode;}}`,
  );
  spyGit = join(tools, 'git.exe');
  execFileSync(CSC, ['/nologo', '/target:exe', `/out:${spyGit}`, spy], { stdio: 'pipe' });
});

test.afterAll(() => {
  rmSync(tools, { recursive: true, force: true, maxRetries: 3 });
});

/** Copia el ejecutable falso con el nombre de un IDE, en la ruta que iría de verdad. */
function plantIde(root: string, ...parts: string[]): string {
  const file = join(root, ...parts);
  mkdirSync(dirname(file), { recursive: true });
  copyFileSync(fakeExe, file);
  return file;
}

async function ideCalls(exe: string, expected: number): Promise<string[][]> {
  await expect.poll(() => (existsSync(`${exe}.log`) ? readFileSync(`${exe}.log`, 'utf8').trim().split('\n').length : 0), { timeout: 10_000 }).toBe(expected);
  return readFileSync(`${exe}.log`, 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split('\u0001'));
}

test('muestra cada tipo de cambio, con cuentas, verde, rojo y sin signos', async () => {
  const dir = fullRepo();
  const run = await launch({ state: stateFor(dir), width: 1400, height: 860 });
  try {
    const { page } = run;
    await openPanel(page);
    await expect(page.locator('.cf-row')).toHaveCount(6);
    const kinds = await page.locator('.cf-row').evaluateAll((els) => els.map((e) => [e.getAttribute('data-file'), e.getAttribute('data-kind')]));
    expect(Object.fromEntries(kinds as [string, string][])).toEqual({
      'agregado.txt': 'added',
      'borrar.txt': 'deleted',
      'logo.png': 'modified',
      'nuevo sin agregar.txt': 'untracked',
      'renombrado.txt': 'renamed',
      'src/App.java': 'modified',
    });
    await expect(fileRow(page, 'ruido.log')).toHaveCount(0);
    await expect(fileRow(page, 'src/App.java').locator('.cf-add')).toHaveText('4');
    await expect(fileRow(page, 'src/App.java').locator('.cf-del')).toHaveText('3');
    await expect(fileRow(page, 'nuevo sin agregar.txt').locator('.cf-add')).toHaveText('4');
    await expect(fileRow(page, 'logo.png').locator('.cf-count')).toHaveText('binario');
    await expect(fileRow(page, 'renombrado.txt')).toHaveAttribute('title', /viejo\.txt/);

    // El archivo modificado: zonas, números y colores.
    await fileRow(page, 'src/App.java').click();
    await expect(page.locator('.dr.add').first()).toBeVisible();
    expect(await page.locator('.dr.add').count()).toBe(4);
    expect(await page.locator('.dr.del').count()).toBe(3);
    await expect(page.locator('.dr.gap')).not.toHaveCount(0);
    await expect(page.locator('.dr.gap').first()).toContainText('sin cambios');
    await expect(page.locator('.dr-sign')).toHaveCount(0);
    const addRow = page.locator('.dr.add').first();
    await expect(addRow.locator('[data-new-line]')).toHaveText('3');
    await expect(addRow.locator('.dr-code')).toContainText('línea 3 cambiada');
    await expect(addRow.locator('.dr-code')).not.toContainText('+');
    const colors = await page.evaluate(() => {
      const bg = (s: string) => getComputedStyle(document.querySelector(s)!).backgroundColor;
      return { add: bg('.dr.add'), del: bg('.dr.del'), ctx: bg('.dr.ctx') };
    });
    expect(colors.add).not.toBe(colors.del);
    expect(colors.add).not.toBe(colors.ctx);
    // Accesible sin el color: lo dice en texto y por la columna del número.
    await expect(addRow.locator('.sr-only')).toHaveText('Línea nueva.');
    await expect(page.locator('.dr.del').first().locator('.sr-only')).toHaveText('Línea quitada.');
    await expect(page.locator('.dr.del').first().locator('[data-old-line]')).toHaveText('3');
    expect(await page.locator('.dr.del [data-new-line]').count()).toBe(0);
    await page.screenshot({ path: join(SHOTS, '01-lado-a-lado-sin-signos.png') });

    // Se puede seleccionar el código: sin números, sin signos y sin el texto para lectores de pantalla.
    const selected = await page.evaluate(() => {
      const sel = window.getSelection()!;
      sel.selectAllChildren(document.querySelector('.diff-window')!);
      const text = sel.toString();
      sel.removeAllRanges();
      return text;
    });
    expect(selected).toContain('línea 3 cambiada');
    expect(selected).not.toContain('Línea nueva');
    expect(selected.split('\n')[0]).toBe('línea 1');

    // Con los signos encendidos.
    await page.evaluate(() => (window as any).hilo.dispatch({ type: 'settings/set', patch: { changesShowSigns: true } }));
    await expect(page.locator('.dr.add .dr-sign').first()).toHaveText('+');
    await expect(page.locator('.dr.del .dr-sign').first()).toHaveText('−');
    await expect(fileRow(page, 'src/App.java').locator('.cf-add')).toHaveText('+4');
    await page.screenshot({ path: join(SHOTS, '02-con-signos.png') });
    await page.evaluate(() => (window as any).hilo.dispatch({ type: 'settings/set', patch: { changesShowSigns: false } }));

    // Todo el archivo.
    await page.locator('[data-action="full-file"]').click();
    await expect(page.locator('.dr.ctx[data-kind="ctx"] [data-new-line="1"]')).toBeVisible();
    await expect(page.locator('.dr.gap')).toHaveCount(0);
    expect((await settings(page)).changesFullFile).toBe(true);
    await expect(page.locator('.diff-jump-count')).toHaveText('2 zonas');
    await expect(page.locator('.diff-jump')).toBeVisible();
    await page.getByRole('button', { name: 'Zona cambiada siguiente' }).click();
    await page.waitForTimeout(150);
    expect(await page.locator('.diff-scroll').evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
    await page.screenshot({ path: join(SHOTS, '03-todo-el-archivo.png') });
    await page.getByRole('radio', { name: 'Lo cambiado' }).click();
    await expect(page.locator('.dr.gap').first()).toBeVisible();

    // Borrado: todo en rojo, y sin números que abran nada.
    await fileRow(page, 'borrar.txt').click();
    await expect(page.locator('.dr.del')).toHaveCount(5);
    await expect(page.locator('.dr-link')).toHaveCount(0);
    await page.screenshot({ path: join(SHOTS, '04-borrado.png') });

    // Renombrado: solo la línea distinta.
    await fileRow(page, 'renombrado.txt').click();
    await expect(page.locator('.changes-oldpath')).toContainText('viejo.txt');
    await expect(page.locator('.dr.add')).toHaveCount(1);
    await expect(page.locator('.dr.add .dr-code')).toContainText('contenido veinte');

    // Nuevo sin rastrear: todas verdes y numeradas.
    await fileRow(page, 'nuevo sin agregar.txt').click();
    await expect(page.locator('.dr.add')).toHaveCount(4);
    await expect(page.locator('.dr.add').nth(3).locator('[data-new-line]')).toHaveText('4');

    // Agregado a git, todavía sin commit.
    await fileRow(page, 'agregado.txt').click();
    await expect(page.locator('.dr.add')).toHaveCount(2);

    // Binario.
    await fileRow(page, 'logo.png').click();
    await expect(page.locator('.changes-state-title')).toHaveText('Archivo binario');
    await page.screenshot({ path: join(SHOTS, '05-binario.png') });
  } finally {
    await run.close();
    cleanup(run.dataDir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('estados: no es un repositorio, sin cambios, sin commits, git no instalado, demasiado grande', async () => {
  const plain = mkdtempSync(join(tmpdir(), 'hilo-plain-'));
  const clean = emptyRepo();
  writeFileSync(join(clean, 'a.txt'), 'hola\n');
  commitAll(clean);
  const unborn = emptyRepo();
  writeFileSync(join(unborn, 'primero.txt'), 'uno\ndos\n');
  git(unborn, 'add', 'primero.txt');
  writeFileSync(join(unborn, 'suelto.txt'), 'tres\n');
  const big = emptyRepo();
  writeFileSync(join(big, 'grande.txt'), 'x\n');
  writeFileSync(join(big, 'chico.txt'), lines(10));
  commitAll(big);
  // Más que el límite de 5 MB, con cambios en toda su extensión.
  writeFileSync(join(big, 'grande.txt'), `${'0123456789abcdef\n'.repeat(400_000)}`);
  writeFileSync(join(big, 'enorme-nuevo.txt'), `${'0123456789abcdef\n'.repeat(400_000)}`);
  writeFileSync(join(big, 'chico.txt'), lines(10, 'otra'));
  const runs: Launched[] = [];
  try {
    let run = await launch({ state: stateFor(plain), width: 1100, height: 700 });
    runs.push(run);
    await openPanel(run.page);
    await expect(run.page.locator('.changes')).toHaveAttribute('data-status', 'not-repo');
    await expect(run.page.locator('.changes-state-title')).toHaveText('Esta carpeta no usa Git');
    await expect(run.page.locator('.changes-state-text')).toContainText('git init');
    await run.page.screenshot({ path: join(SHOTS, '06-no-es-repositorio.png') });
    await run.close();
    expect(existsSync(join(plain, '.git'))).toBe(false);

    run = await launch({ state: stateFor(clean), width: 1100, height: 700 });
    runs.push(run);
    await openPanel(run.page);
    await expect(run.page.locator('.changes-state-title')).toHaveText('Sin cambios');
    await run.page.screenshot({ path: join(SHOTS, '07-sin-cambios.png') });
    await run.close();

    run = await launch({ state: stateFor(unborn), width: 1100, height: 700 });
    runs.push(run);
    await openPanel(run.page);
    await expect(run.page.locator('.cf-row')).toHaveCount(2);
    await expect(run.page.locator('.changes-note')).toContainText('sin ningún commit');
    await fileRow(run.page, 'primero.txt').click();
    await expect(run.page.locator('.dr.add')).toHaveCount(2);
    await run.close();

    run = await launch({ state: stateFor(clean), width: 1100, height: 700, env: { HILO_TEST_GIT: 'C:\\no\\existe\\git.exe' } });
    runs.push(run);
    await openPanel(run.page);
    await expect(run.page.locator('.changes')).toHaveAttribute('data-status', 'no-git');
    await expect(run.page.locator('.changes-state-title')).toHaveText('Git no está instalado');
    await run.page.screenshot({ path: join(SHOTS, '08-git-no-instalado.png') });
    await run.close();

    run = await launch({ state: stateFor(big), width: 1100, height: 700 });
    runs.push(run);
    await openPanel(run.page);
    await fileRow(run.page, 'grande.txt').click();
    await expect(run.page.locator('.changes-state-title')).toHaveText('Archivo demasiado grande');
    await run.page.screenshot({ path: join(SHOTS, '09-demasiado-grande.png') });
    await fileRow(run.page, 'enorme-nuevo.txt').click();
    await expect(run.page.locator('.changes-state-text')).toContainText('MB');
    await expect(run.page.locator('.changes-state-title')).toHaveText('Archivo demasiado grande');
    // La interfaz sigue viva y lo demás se puede ver.
    await fileRow(run.page, 'chico.txt').click();
    await expect(run.page.locator('.dr.add')).toHaveCount(10);
    await expect(fileRow(run.page, 'grande.txt').locator('.cf-add')).toHaveText('400000');
    await run.close();

    // La carpeta se borró: se dice, y no rompe nada.
    const gone = mkdtempSync(join(tmpdir(), 'hilo-ida-'));
    const stale = stateFor(gone);
    rmSync(gone, { recursive: true, force: true });
    run = await launch({ state: stale, width: 1100, height: 700 });
    runs.push(run);
    await openPanel(run.page);
    await expect(run.page.locator('.changes')).toHaveAttribute('data-status', 'no-folder');
    await run.close();
  } finally {
    for (const r of runs) {
      await r.close().catch(() => undefined);
      cleanup(r.dataDir);
    }
    for (const d of [plain, clean, unborn, big]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('un archivo modificado grande se dibuja por partes y no llena la página', async () => {
  const dir = emptyRepo();
  writeFileSync(join(dir, 'largo.txt'), lines(60_000));
  commitAll(dir);
  writeFileSync(join(dir, 'largo.txt'), lines(60_000, 'distinta'));
  // Más archivos nuevos que el máximo de la lista.
  mkdirSync(join(dir, 'muchos'));
  for (let i = 0; i < 2100; i++) writeFileSync(join(dir, 'muchos', `f${i}.txt`), 'x\n');
  const run = await launch({ state: stateFor(dir), width: 1200, height: 760 });
  try {
    const { page } = run;
    await openPanel(page);
    await expect(page.locator('.cf-row')).toHaveCount(2000);
    await expect(page.locator('.changes-summary')).toContainText('2101 archivos');
    await expect(page.locator('.changes-note')).toContainText('se muestran 2000');
    await expect(fileRow(page, 'largo.txt')).toHaveCount(1);
    await fileRow(page, 'largo.txt').click();
    await expect(page.locator('.dr.del').first()).toBeVisible();
    await page.screenshot({ path: join(SHOTS, '19-archivo-largo.png') });
    expect(await page.locator('.dr').count()).toBeLessThan(400);
    await page.locator('.diff-scroll').evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await expect(page.locator('[data-new-line="60000"]')).toBeVisible();
    expect(await page.locator('.dr').count()).toBeLessThan(400);
  } finally {
    await run.close();
    cleanup(run.dataDir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('se actualiza con el botón, al volver a la ventana y al terminar una sesión; quitado no gasta nada', async () => {
  const dir = fullRepo();
  const spyLog = `${spyGit}.log`;
  rmSync(spyLog, { force: true });
  const run = await launch({ state: stateFor(dir), width: 1200, height: 760, env: { HILO_TEST_GIT: spyGit } });
  const calls = () => (existsSync(spyLog) ? readFileSync(spyLog, 'utf8').trim().split('\n').length : 0);
  try {
    const { page } = run;
    // Antes de abrir el panel, git ni se lanza.
    await settle(500);
    expect(calls()).toBe(0);
    await openPanel(page);
    await expect(page.locator('.cf-row')).toHaveCount(6);

    writeFileSync(join(dir, 'boton.txt'), 'uno\n');
    await settle(100);
    await expect(fileRow(page, 'boton.txt')).toHaveCount(0);
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await expect(fileRow(page, 'boton.txt')).toHaveCount(1);

    // Volver a la ventana.
    await page.evaluate(() => (window as any).__hiloTest.view.set({ focused: false }));
    writeFileSync(join(dir, 'foco.txt'), 'uno\n');
    await settle(1200);
    await page.evaluate(() => (window as any).__hiloTest.view.set({ focused: true }));
    await expect(fileRow(page, 'foco.txt')).toHaveCount(1);

    // Una sesión del proyecto que deja de trabajar. La señal viene de la máquina de estados, que se prueba aparte.
    writeFileSync(join(dir, 'sesion.txt'), 'uno\n');
    const setStatus = (status: string) =>
      page.evaluate(
        ([id, s]) => {
          const t = (window as any).__hiloTest;
          t.app.set({ runtime: { ...t.app.get().runtime, [id as string]: { status: s } } });
        },
        [A, status],
      );
    await setStatus('working');
    await settle(100);
    await expect(fileRow(page, 'sesion.txt')).toHaveCount(0);
    await setStatus('done');
    await expect(fileRow(page, 'sesion.txt')).toHaveCount(1);

    // Quieto, no vuelve a mirar: nada de sondeo.
    await settle(800);
    const still = calls();
    await settle(3000);
    expect(calls()).toBe(still);

    // Solo se pidió leer. Esta lista es la promesa de D21.
    const log = readFileSync(spyLog, 'utf8').trim().split('\n');
    const commands = new Set(log.map((l) => /(?:^| )(rev-parse|config|hash-object|diff|ls-files|add|checkout|stash|reset|status|commit|fetch|pull|push|clean|restore|apply|update-index)(?: |$)/.exec(l.replace(/-c \S+/g, ''))?.[1]));
    expect([...commands].sort()).toEqual(['config', 'diff', 'ls-files', 'rev-parse']);
    for (const l of log) {
      expect(l).toContain('--no-pager');
      expect(l).toContain('core.fsmonitor=false');
      expect(l).toContain('core.hooksPath=/dev/null');
      if (/ diff /.test(l)) {
        expect(l).toContain('--no-ext-diff');
        expect(l).toContain('--no-textconv');
      }
    }
    // El config de los filtros no se usa para escribir nada.
    expect(log.filter((l) => / config /.test(l)).every((l) => l.includes('--get-regexp'))).toBe(true);

    // Ya no está a la vista: ni el foco ni una sesión lo despiertan.
    await page.locator('.pane-close').last().click();
    await expect(page.locator('.changes')).toHaveCount(0);
    await settle(300);
    const before = calls();
    await page.evaluate(() => (window as any).__hiloTest.view.set({ focused: false }));
    await settle(1200);
    await page.evaluate(() => (window as any).__hiloTest.view.set({ focused: true }));
    await setStatus('working');
    await settle(100);
    await setStatus('done');
    await settle(900);
    expect(calls()).toBe(before);
  } finally {
    await run.close();
    cleanup(run.dataDir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    rmSync(spyLog, { force: true });
  }
});

test('un repositorio con configuración maliciosa no ejecuta nada ni escribe el índice', async () => {
  const dir = emptyRepo();
  const marks = mkdtempSync(join(tmpdir(), 'hilo-marcas-'));
  const mark = (name: string) => `echo x >> '${join(marks, name).replace(/\\/g, '/')}'`;
  writeFileSync(join(dir, 'a.txt'), lines(5));
  writeFileSync(join(dir, 'plano.txt'), lines(2));
  // `plano.txt` queda sin driver: es el caso en que manda `diff.external`.
  writeFileSync(join(dir, '.gitattributes'), '* diff=malo filter=malo\nplano.txt !diff !filter\n');
  commitAll(dir);
  writeFileSync(join(dir, 'a.txt'), lines(5, 'otra'));
  writeFileSync(join(dir, 'plano.txt'), lines(2, 'otra'));
  writeFileSync(join(dir, 'nuevo.txt'), 'hola\n');
  const hooks = join(dir, 'ganchos');
  mkdirSync(hooks);
  writeFileSync(join(hooks, 'post-index-change'), `#!/bin/sh\n${mark('hook')}\n`);
  const cfg: [string, string][] = [
    ['core.fsmonitor', mark('fsmonitor')],
    ['core.pager', mark('pager')],
    ['core.sshCommand', mark('ssh')],
    ['core.hooksPath', hooks.replace(/\\/g, '/')],
    ['diff.external', mark('external')],
    ['diff.malo.command', mark('driver')],
    ['diff.malo.textconv', mark('textconv')],
    ['filter.malo.clean', mark('clean')],
    ['filter.malo.smudge', mark('smudge')],
    ['filter.malo.process', mark('process')],
    ['filter.malo.required', 'true'],
  ];
  for (const [key, value] of cfg) git(dir, 'config', key, value);
  // Un git.exe dentro del repositorio: `spawn('git', { cwd })` en Windows lo preferiría al de verdad.
  copyFileSync(fakeExe, join(dir, 'git.exe'));

  // Control: el mismo repositorio, con un git sin blindar, sí ejecuta. Si esto no pasara, la prueba no valdría nada.
  const fired = (name: string) => existsSync(join(marks, name));
  const plain = (...args: string[]) => spawnSync(realGit, args, { cwd: dir, encoding: 'utf8' });
  plain('diff', 'HEAD');
  expect(fired('fsmonitor')).toBe(true);
  expect(fired('process')).toBe(true);
  // Un filtro con `process` deja de lado su `clean`: para ver los demás, se quita un momento.
  git(dir, 'config', '--unset', 'filter.malo.process');
  plain('diff', 'HEAD');
  expect(fired('driver')).toBe(true);
  plain('diff', '--no-ext-diff', 'HEAD');
  expect(fired('textconv')).toBe(true);
  plain('-c', 'core.fsmonitor=false', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD');
  expect(fired('clean')).toBe(true);
  plain('-c', 'core.fsmonitor=false', 'diff', 'HEAD', '--', 'plano.txt');
  expect(fired('external')).toBe(true);
  plain('status');
  expect(fired('hook')).toBe(true);
  // Windows mira primero en la carpeta actual. Claude Code define esta variable, que un PC normal no tiene,
  // y la que cuenta es la del proceso que lanza: por eso el control va en un proceso aparte.
  const { NoDefaultCurrentDirectoryInExePath: _ignored, ...normalEnv } = process.env;
  spawnSync(process.execPath, ['-e', `require('child_process').spawnSync('git',['--version'],{cwd:process.argv[1]})`, dir], { env: normalEnv });
  expect(existsSync(`${join(dir, 'git.exe')}.log`)).toBe(true);
  // Apunta a una ruta que no existe: si se respetara, git fallaría y el panel no mostraría nada.
  git(dir, 'config', 'diff.orderFile', join(marks, 'orden.txt').replace(/\\/g, '/'));
  for (const name of ['fsmonitor', 'pager', 'ssh', 'external', 'driver', 'textconv', 'clean', 'smudge', 'process', 'hook']) rmSync(join(marks, name), { force: true });
  rmSync(`${join(dir, 'git.exe')}.log`, { force: true });
  const indexHash = () => createHash('sha256').update(readFileSync(join(dir, '.git', 'index'))).digest('hex');
  // Se deja el índice como está, con lo que dejó el control.
  const before = indexHash();
  const configBefore = readFileSync(join(dir, '.git', 'config'), 'utf8');

  // La app corre como en un PC normal, donde el git.exe del repositorio sería una amenaza real.
  const savedVar = process.env.NoDefaultCurrentDirectoryInExePath;
  delete process.env.NoDefaultCurrentDirectoryInExePath;
  const run = await launch({ state: stateFor(dir), width: 1100, height: 700 });
  if (savedVar !== undefined) process.env.NoDefaultCurrentDirectoryInExePath = savedVar;
  try {
    const { page } = run;
    await openPanel(page);
    await expect(fileRow(page, 'a.txt')).toHaveCount(1);
    await fileRow(page, 'a.txt').click();
    await expect(page.locator('.dr.add').first()).toBeVisible();
    await expect(page.locator('.dr.add')).toHaveCount(5);
    await fileRow(page, 'nuevo.txt').click();
    await expect(page.locator('.dr.add')).toHaveCount(1);
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await settle(800);
    await page.screenshot({ path: join(SHOTS, '10-repo-malicioso.png') });
    for (const name of ['fsmonitor', 'pager', 'ssh', 'external', 'driver', 'textconv', 'clean', 'smudge', 'process', 'hook']) {
      expect(fired(name), `se ejecutó ${name}`).toBe(false);
    }
    // Y con el filtro de procesos, que tiene su propio camino en git.
    git(dir, 'config', 'filter.malo.process', mark('process'));
    const configWithProcess = readFileSync(join(dir, '.git', 'config'), 'utf8');
    await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await fileRow(page, 'a.txt').click();
    await expect(page.locator('.dr.add')).toHaveCount(5);
    await settle(500);
    for (const name of ['fsmonitor', 'pager', 'ssh', 'external', 'driver', 'textconv', 'clean', 'smudge', 'process', 'hook']) {
      expect(fired(name), `se ejecutó ${name}`).toBe(false);
    }
    expect(existsSync(`${join(dir, 'git.exe')}.log`), 'se ejecutó el git.exe del repositorio').toBe(false);
    expect(indexHash()).toBe(before);
    expect(readFileSync(join(dir, '.git', 'config'), 'utf8')).toBe(configWithProcess);
    expect(configBefore).not.toBe(configWithProcess);
  } finally {
    await run.close();
    cleanup(run.dataDir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    rmSync(marks, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('filtros con nombres que no se pueden anular: no se lee, y `core.worktree` ajeno no cuenta como repositorio', async () => {
  const dir = emptyRepo();
  const marks = mkdtempSync(join(tmpdir(), 'hilo-marcas-'));
  writeFileSync(join(dir, 'a.txt'), 'uno\n');
  writeFileSync(join(dir, '.gitattributes'), '* filter=a=b\n');
  commitAll(dir);
  writeFileSync(join(dir, 'a.txt'), 'dos\n');
  writeFileSync(join(dir, '.git', 'config'), `${readFileSync(join(dir, '.git', 'config'), 'utf8')}[filter "a=b"]\n\tclean = "echo x >> '${join(marks, 'clean').replace(/\\/g, '/')}'"\n`);
  const other = emptyRepo();
  const elsewhere = mkdtempSync(join(tmpdir(), 'hilo-otra-'));
  git(other, 'config', 'core.worktree', elsewhere.replace(/\\/g, '/'));
  let run = await launch({ state: stateFor(dir), width: 1100, height: 700 });
  const dataDirs = [run.dataDir];
  try {
    await openPanel(run.page);
    await expect(run.page.locator('.changes')).toHaveAttribute('data-status', 'unsafe-config');
    await settle(300);
    expect(existsSync(join(marks, 'clean'))).toBe(false);
    await run.close();

    run = await launch({ state: stateFor(other), width: 1100, height: 700 });
    dataDirs.push(run.dataDir);
    await openPanel(run.page);
    await expect(run.page.locator('.changes')).toHaveAttribute('data-status', 'not-repo');
  } finally {
    await run.close();
    for (const d of [...dataDirs, dir, other, elsewhere, marks]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('rutas maliciosas: fuera de la carpeta, por una unión, absolutas; y el renderer no elige el IDE', async () => {
  const dir = fullRepo();
  const outside = mkdtempSync(join(tmpdir(), 'hilo-afuera-'));
  writeFileSync(join(outside, 'secreto.txt'), 'SECRETO\n');
  symlinkSync(outside, join(dir, 'salida'), 'junction');
  const root = mkdtempSync(join(tmpdir(), 'hilo-ides-'));
  const nb = plantIde(root, 'pf', 'NetBeans-23', 'netbeans', 'bin', 'netbeans64.exe');
  const run = await launch({
    state: stateFor(dir, (s) => {
      s.projects[0]!.ide = { path: nb, name: 'NetBeans 23' };
    }),
    width: 1100,
    height: 700,
  });
  try {
    const { page } = run;
    const diff = (path: unknown, extra: Record<string, unknown> = {}) =>
      page.evaluate(([p, e]) => (window as any).hilo.changesDiff('proy', { path: p, untracked: true, full: false, ...(e as object) }), [path, extra] as const);
    for (const bad of ['../x.txt', '..\\x.txt', 'src/../../x.txt', 'C:\\Windows\\win.ini', '/etc/hosts', '\\\\servidor\\c$\\a', 'a.txt:oculto', '.git/config', 'salida/secreto.txt', 'salida', 'CON', '', 42, null]) {
      expect(await diff(bad), `ruta ${JSON.stringify(bad)}`).toEqual({ status: 'rejected' });
    }
    expect(await diff('renombrado.txt', { untracked: false, oldPath: '../afuera.txt' })).toEqual({ status: 'rejected' });
    // Lo legítimo sigue funcionando.
    expect((await diff('nuevo sin agregar.txt') as { status: string }).status).toBe('new');
    // Un proyecto inexistente o un id raro.
    const result = await page.evaluate(() => (window as any).hilo.changesList('../proy'));
    expect(result).toEqual({ status: 'no-project' });

    // Abrir en el IDE pasa por la misma comprobación.
    const open = (path: unknown, line: unknown) => page.evaluate(([p, l]) => (window as any).hilo.ideOpen('proy', p, l), [path, line] as const);
    for (const bad of ['../x.txt', 'C:\\Windows\\win.ini', 'salida/secreto.txt', '.git/config']) {
      expect(await open(bad, 1), `ruta ${bad}`).toMatchObject({ ok: false, reason: 'file' });
    }
    expect(existsSync(`${nb}.log`)).toBe(false);

    // Elegir un IDE con una ruta: ni como acción, ni dentro de un proyecto, ni con un id que no salió de la detección.
    const evil = 'C:\\Windows\\System32\\calc.exe';
    const rejected = await page.evaluate(async ([path]) => {
      const out: string[] = [];
      const h = (window as any).hilo;
      await h.dispatch({ type: 'project/ide', id: 'proy', ide: { path, name: 'x' } }).catch((e: Error) => out.push(e.message));
      await h.dispatch({ type: 'project/add', project: { id: 'otro', name: 'otro', path: 'C:\\', color: null, collapsed: false, sessions: [], ide: { path, name: 'x' } } }).catch((e: Error) => out.push(e.message));
      out.push(String(await h.ideChoose('proy', path)));
      out.push(String(await h.ideChoose('proy', 'ide-99')));
      return out;
    }, [evil] as const);
    expect(rejected.filter((m) => m.includes('no permitida')).length).toBe(2);
    expect(rejected.slice(2)).toEqual(['false', 'false']);
    expect((await project(page)).ide.path).toBe(nb);
    expect(await page.evaluate(() => (window as any).__hiloTest.app.get().state.projects.length)).toBe(1);

    // Y el panel no muestra lo que hay detrás de la unión.
    await openPanel(page);
    await page.locator('.cf-row').first().waitFor();
    await expect(page.locator('.changes')).not.toContainText('SECRETO');
  } finally {
    await run.close();
    cleanup(run.dataDir);
    for (const d of [dir, outside, root]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('abrir en el IDE: elegir, recordar por proyecto, ir a la línea, sin shell', async () => {
  const dir = fullRepo();
  const special = 'a&b (c) 100%.txt';
  writeFileSync(join(dir, special), lines(3));
  const root = mkdtempSync(join(tmpdir(), 'hilo-ides-'));
  const nb = plantIde(root, 'pf', 'NetBeans-23', 'netbeans', 'bin', 'netbeans64.exe');
  const code = plantIde(root, 'local', 'Programs', 'Microsoft VS Code', 'Code.exe');
  const vs = plantIde(root, 'pf', 'Microsoft Visual Studio', '2022', 'Community', 'Common7', 'IDE', 'devenv.exe');
  const manual = plantIde(root, 'manual dir', 'pycharm64.exe');
  const cmd = join(root, 'code.cmd');
  writeFileSync(cmd, '@echo off\n');
  const run = await launch({ state: stateFor(dir), width: 1300, height: 800, env: { HILO_TEST_IDE_ROOT: root } });
  const { dataDir } = run;
  let second: Launched | null = null;
  try {
    const { page } = run;
    await openPanel(page);
    await fileRow(page, 'src/App.java').click();
    await expect(page.locator('.dr.add').first()).toBeVisible();

    // Sin IDE elegido, un clic en un número pregunta primero, y después abre esa línea.
    await page.locator('.dr.add').first().locator('[data-new-line]').click();
    await expect(page.locator('.dialog h2')).toContainText('¿Con qué abrir');
    await expect(page.locator('.ide-item')).toHaveCount(3);
    await page.screenshot({ path: join(SHOTS, '11-elegir-ide.png') });
    await page.locator('.ide-item[data-ide="NetBeans 23"]').click();
    await expect(page.locator('.dialog')).toHaveCount(0);
    const abs = join(dir, 'src', 'App.java');
    let calls = await ideCalls(nb, 1);
    expect(calls[0]).toEqual(['--open', `${abs}:3`]);
    expect((await project(page)).ide).toEqual({ path: nb, name: 'NetBeans 23' });
    await expect(page.locator('[data-action="open-ide"]')).toHaveText('Abrir en NetBeans 23');
    await page.screenshot({ path: join(SHOTS, '12-con-ide.png') });

    // Otra línea, una quitada (lleva a donde estaba), y el proyecto entero.
    await page.locator('.dr.add').nth(1).locator('[data-new-line]').click();
    calls = await ideCalls(nb, 2);
    expect(calls[1]).toEqual(['--open', `${abs}:41`]);
    await page.locator('.dr.del').first().locator('[data-old-line]').click();
    calls = await ideCalls(nb, 3);
    expect(calls[2]).toEqual(['--open', `${abs}:3`]);
    await page.locator('[data-action="open-ide"]').click();
    calls = await ideCalls(nb, 4);
    expect(calls[3]).toEqual(['--open', dir]);

    // Un nombre con caracteres de shell llega tal cual y no ejecuta nada.
    await fileRow(page, special).click();
    await page.locator('.dr.add').first().locator('[data-new-line]').click();
    calls = await ideCalls(nb, 5);
    expect(calls[4]).toEqual(['--open', `${join(dir, special)}:1`]);

    // Clic derecho en el proyecto: abre, y deja cambiar.
    await fileRow(page, 'src/App.java').click();
    await page.locator('[data-action="open-file"]').click();
    calls = await ideCalls(nb, 6);
    expect(calls[5]).toEqual(['--open', abs]);
    await page.locator(`[data-project="proy"] .project-head`).click({ button: 'right' });
    await page.screenshot({ path: join(SHOTS, '13-menu-proyecto.png') });
    await page.locator('[data-action="menu-ide"]').click();
    calls = await ideCalls(nb, 7);
    expect(calls[6]).toEqual(['--open', dir]);

    await page.locator(`[data-project="proy"] .project-head`).click({ button: 'right' });
    await page.locator('[data-action="menu-ide-change"]').click();
    await page.locator('.ide-item[data-ide="Visual Studio Code"]').click();
    await expect(page.locator('[data-action="open-ide"]')).toHaveText('Abrir en Visual Studio Code');
    // Cambiar de IDE no abre nada por su cuenta.
    await settle(300);
    expect(existsSync(`${code}.log`)).toBe(false);
    await fileRow(page, 'src/App.java').click();
    await page.locator('.dr.add').first().locator('[data-new-line]').click();
    expect((await ideCalls(code, 1))[0]).toEqual([dir, '--goto', `${abs}:3`]);

    // Visual Studio no va a la línea: abre el archivo y lo dice.
    await page.locator(`[data-project="proy"] .project-head`).click({ button: 'right' });
    await page.locator('[data-action="menu-ide-change"]').click();
    await page.locator('.ide-item[data-ide="Visual Studio 2022 Community"]').click();
    await page.locator('.dr.add').first().locator('[data-new-line]').click();
    expect((await ideCalls(vs, 1))[0]).toEqual(['/Edit', abs]);
    await expect(page.locator('.toast').last()).toContainText('Es la línea 3');

    // Un .exe elegido con el diálogo nativo, que aquí se sustituye. Un .cmd se rechaza.
    const pick = (file: string) =>
      run.app.evaluate(({ dialog }, f) => {
        (dialog as any).showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
      }, file);
    await page.locator(`[data-project="proy"] .project-head`).click({ button: 'right' });
    await page.locator('[data-action="menu-ide-change"]').click();
    await pick(cmd);
    await page.locator('[data-action="pick-exe"]').click();
    await expect(page.locator('.dialog .warn')).toContainText('.exe');
    expect((await project(page)).ide.path).toBe(vs);
    await pick(manual);
    await page.locator('[data-action="pick-exe"]').click();
    await expect(page.locator('.dialog')).toHaveCount(0);
    expect((await project(page)).ide).toEqual({ path: manual, name: 'PyCharm' });
    await page.locator('.dr.add').first().locator('[data-new-line]').click();
    expect((await ideCalls(manual, 1))[0]).toEqual(['--line', '3', abs]);

    // Se recuerda al reabrir.
    await run.close();
    second = await launch({ dataDir, env: { HILO_TEST_IDE_ROOT: root } });
    expect((await project(second.page)).ide).toEqual({ path: manual, name: 'PyCharm' });

    // Si el programa ya no está, lo dice y deja elegir otro.
    await second.close();
    renameSync(manual, `${manual}.ido`);
    second = await launch({ dataDir, env: { HILO_TEST_IDE_ROOT: root } });
    await second.page.locator('[data-action="open-ide"]').click();
    await expect(second.page.locator('.toast').last()).toContainText('No se encontró');
    await expect(second.page.locator('.dialog h2')).toContainText('¿Con qué abrir');
  } finally {
    await second?.close();
    await run.close().catch(() => undefined);
    cleanup(dataDir);
    for (const d of [dir, root]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('vive en el árbol: dividir, arrastrar, reemplazar, cerrar, atajo y reabrir la app', async () => {
  const dir = fullRepo();
  const run = await launch({ state: stateFor(dir), width: 1300, height: 800 });
  const { dataDir } = run;
  let second: Launched | null = null;
  try {
    const { page } = run;
    // El atajo lo abre al lado, y deja la sesión en su sitio.
    await page.keyboard.press('Control+Shift+G');
    await expect(page.locator('.changes')).toBeVisible();
    let state = await ui(page);
    expect(state.panes).toEqual([A, CH]);
    expect(state.tree).toEqual({ dir: 'row', kids: [0, 1] });
    expect(state.activePane).toBe(1);
    expect(state.activeSessionId).toBeNull();
    await expect(page.locator('.changes')).toBeFocused();
    await expect(page.locator('[data-action="toggle-changes"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('.cf-row').first().waitFor();
    await page.screenshot({ path: join(SHOTS, '14-dividido-vertical.png') });

    // Las pestañas siguen siendo del proyecto, y elegir una sesión no se come el panel.
    await expect(page.locator('.tabs')).toHaveAttribute('aria-label', 'Sesiones de proyecto');
    await page.locator(`.row[data-session="${B}"]`).click();
    await expect.poll(async () => (await ui(page)).panes).toEqual([B, CH]);
    expect((await ui(page)).activeSessionId).toBe(B);

    // Dividir en horizontal arrastrando la cabecera del panel al borde inferior de la terminal.
    const from = (await page.locator('[data-pane="1"] .pane-head').boundingBox())!;
    const to = (await page.locator('[data-pane="0"]').boundingBox())!;
    await page.mouse.move(from.x + 80, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 20, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.97, { steps: 8 });
    await page.waitForTimeout(120);
    await expect(page.locator('.drop-mark.edge.bottom')).toBeVisible();
    await page.mouse.up();
    await expect.poll(async () => (await ui(page)).tree.dir).toBe('col');
    state = await ui(page);
    expect(state.panes.length).toBe(2);
    expect(state.panes).toContain(CH);
    await page.locator('.cf-row').first().waitFor();
    await page.screenshot({ path: join(SHOTS, '15-dividido-horizontal.png') });

    // Soltar una sesión sobre el panel lo reemplaza; la sesión sigue en la barra.
    const row = (await page.locator(`.row[data-session="${A}"]`).boundingBox())!;
    const pane = (await page.locator(`[data-pane="${state.panes.indexOf(CH)}"]`).boundingBox())!;
    await page.mouse.move(row.x + 20, row.y + row.height / 2);
    await page.mouse.down();
    await page.mouse.move(row.x + 40, row.y + row.height / 2 + 4, { steps: 3 });
    await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2, { steps: 6 });
    await page.waitForTimeout(120);
    await expect(page.locator('.drop-label')).toHaveText('Reemplazar «Cambios»');
    await page.mouse.up();
    await expect(page.locator('.changes')).toHaveCount(0);
    expect((await ui(page)).panes).not.toContain(CH);

    // Desde el selector de un panel vacío.
    await page.getByRole('button', { name: 'Ver 3 terminales', exact: true }).click();
    await page.locator('[data-pick-changes]').click();
    await expect(page.locator('.changes')).toBeVisible();
    expect((await ui(page)).panes[2]).toBe(CH);

    // Con la X se va, y lo de al lado se queda.
    await page.locator('[data-pane="2"] .pane-close').click();
    await expect(page.locator('.changes')).toHaveCount(0);
    expect((await ui(page)).panes.length).toBe(2);

    // El botón es un interruptor; con 4 paneles llenos lo avisa en vez de quitar uno.
    await page.locator('[data-action="toggle-changes"]').click();
    await expect(page.locator('.changes')).toBeVisible();
    await page.locator('[data-action="toggle-changes"]').click();
    await expect(page.locator('.changes')).toHaveCount(0);

    // Persistencia: se cierra con el panel a la vista y vuelve igual.
    await page.keyboard.press('Control+Shift+G');
    await expect(page.locator('.changes')).toBeVisible();
    const saved = await ui(page);
    await settle(500);
    await run.close();
    second = await launch({ dataDir });
    const page2 = second.page;
    await expect(page2.locator('.changes')).toBeVisible();
    await expect(page2.locator('.cf-row').first()).toBeVisible();
    const after = await ui(page2);
    expect(after.panes).toEqual(saved.panes);
    expect(after.tree).toEqual(saved.tree);
    expect(after.activeSessionId).toBeNull();
    await expect(page2.locator('.changes')).toHaveAttribute('data-status', 'ok');

    // Quitar el proyecto se lleva el panel y no rompe la app.
    await second.page.evaluate(() => (window as any).hilo.removeProject('proy'));
    await expect(page2.locator('.changes')).toHaveCount(0);
    await expect(page2.locator('.empty')).toBeVisible();
  } finally {
    await second?.close();
    await run.close().catch(() => undefined);
    cleanup(dataDir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('un panel guardado de un proyecto que ya no existe se descarta; el atajo se puede cambiar; solo y sin sesiones', async () => {
  const dir = fullRepo();
  const stale = stateFor(dir, (s) => {
    s.ui = { ...s.ui, layout: 2, panes: [A, changesPaneId('borrado')], activePane: 1, activeSessionId: null, tree: { dir: 'row', kids: [0, 1] } };
    s.settings.shortcuts = { toggleChanges: 'Ctrl+Shift+Y' };
  });
  let run = await launch({ state: stale, width: 1100, height: 700 });
  const dirs = [run.dataDir];
  try {
    await expect(run.page.locator('[data-pane="1"] .picker')).toBeVisible();
    await expect(run.page.locator('.changes')).toHaveCount(0);
    expect((await ui(run.page)).panes).toEqual([A, null]);

    // El atajo cambiado abre el panel, y el de fábrica deja de hacerlo.
    await run.page.keyboard.press('Control+Shift+G');
    await settle(200);
    await expect(run.page.locator('.changes')).toHaveCount(0);
    await run.page.keyboard.press('Control+Shift+Y');
    await expect(run.page.locator('.changes')).toBeVisible();
    await run.close();

    // Solo en la ventana: su X deja el selector; y se ve la configuración en Ajustes.
    const only = stateFor(dir, (s) => {
      s.projects[0]!.sessions = [];
      s.ui = { ...s.ui, layout: 1, panes: [CH], activePane: 0, activeSessionId: null, emptyProjectId: 'proy' };
    });
    run = await launch({ state: only, width: 1100, height: 700 });
    dirs.push(run.dataDir);
    await expect(run.page.locator('.changes')).toBeVisible();
    await expect(run.page.locator('.pane-close')).toBeVisible();
    await run.page.screenshot({ path: join(SHOTS, '16-solo-en-la-ventana.png') });
    await run.page.keyboard.press('Control+,');
    await run.page.locator('.settings-nav button', { hasText: 'Cambios' }).click();
    const signs = run.page.locator('[data-field="changes-signs"]');
    await expect(signs).not.toBeChecked();
    await run.page.screenshot({ path: join(SHOTS, '17-ajustes.png') });
    await signs.check();
    expect((await settings(run.page)).changesShowSigns).toBe(true);
    await run.page.keyboard.press('Escape');
    await run.page.locator('.pane-close').click();
    await expect(run.page.locator('.changes')).toHaveCount(0);
    expect((await ui(run.page)).panes).toEqual([null]);
    await expect(run.page.locator('.overlay-title')).toContainText('no tiene sesiones');
  } finally {
    await run.close().catch(() => undefined);
    for (const d of [...dirs, dir]) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('tema claro y panel angosto: se ve la lista arriba y sin desbordes', async () => {
  const dir = fullRepo();
  const state = stateFor(dir, (s) => {
    s.settings.theme = 'light';
    s.ui = { ...s.ui, layout: 2, panes: [A, CH], activePane: 1, activeSessionId: null, tree: { dir: 'row', kids: [0, 1] } };
  });
  const run = await launch({ state, width: 1000, height: 680 });
  try {
    const { page } = run;
    await expect(page.locator('.cf-row').first()).toBeVisible();
    await fileRow(page, 'src/App.java').click();
    await expect(page.locator('.dr.add').first()).toBeVisible();
    const box = await page.evaluate(() => {
      const list = document.querySelector('.cf-list')!.getBoundingClientRect();
      const diff = document.querySelector('.diff-scroll')!.getBoundingClientRect();
      const panel = document.querySelector('.changes')!.getBoundingClientRect();
      return { listBottom: list.bottom, diffTop: diff.top, panelRight: panel.right, diffRight: diff.right };
    });
    expect(box.listBottom).toBeLessThanOrEqual(box.diffTop + 40);
    expect(box.diffRight).toBeLessThanOrEqual(box.panelRight + 1);
    await page.screenshot({ path: join(SHOTS, '18-claro-angosto.png') });
  } finally {
    await run.close();
    cleanup(run.dataDir);
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
});
