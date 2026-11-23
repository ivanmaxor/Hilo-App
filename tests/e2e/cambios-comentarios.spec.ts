import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup, clearSink, launch, makeState, openSink, readSink, settle, waitForSink, type Launched } from './helpers';

const A = 'aaaaaaaa-5555-4000-8000-00000000000a';
const START = '\x1b[200~';
const END = '\x1b[201~';

let realGit: string;
const dirs: string[] = [];

test.beforeAll(() => {
  realGit = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).split(/\r?\n/).find((l) => /git\.exe$/i.test(l.trim()))!.trim();
});
test.afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync(realGit, ['-c', 'user.name=Hilo', '-c', 'user.email=hilo@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const lines = (tag: string, n = 12) => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`);
const write = (dir: string, file: string, rows: string[]) => writeFileSync(join(dir, file), rows.join('\n') + '\n');

/** Dos archivos con un cambio cada uno: a.txt cambia la línea 3 y b.txt la 5. */
function twoFileRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hilo-repo-'));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'core.autocrlf', 'false');
  mkdirSync(join(dir, 'src'));
  write(dir, 'a.txt', lines('alfa'));
  write(dir, 'src/b.txt', lines('beta'));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'inicio');
  const a = lines('alfa');
  a[2] = 'alfa tres `cambiada`';
  write(dir, 'a.txt', a);
  const b = lines('beta');
  b[4] = 'beta cinco cambiada';
  write(dir, 'src/b.txt', b);
  return dir;
}

async function start(dir: string): Promise<Launched> {
  const state = makeState([{ id: A, name: 'Uno' }], dir);
  state.ui = { ...state.ui, activeSessionId: A, panes: [A], layout: 1, activePane: 0 };
  const run = await launch({ state, width: 1400, height: 860 });
  await openSink(run.page, A);
  clearSink(run.sinkFile);
  await run.page.locator('[data-action="toggle-changes"]').click();
  await expect(run.page.locator('.changes')).toBeVisible();
  await expect(run.page.locator('.changes')).toHaveAttribute('data-status', 'ok');
  return run;
}

const fileRow = (page: Page, path: string) => page.locator(`.cf-row[data-file="${path}"]`);
const lineButton = (page: Page, line: number, side = 'new') => page.locator(`.dr-cmt[data-comment-line="${line}"][data-comment-side="${side}"]`);

async function comment(page: Page, file: string, line: number, text: string, how: 'button' | 'ctrl-enter' = 'button'): Promise<void> {
  await fileRow(page, file).click();
  await expect(page.locator('.changes-path')).toHaveText(file);
  await lineButton(page, line).click();
  const box = page.locator('.cm-editor textarea');
  await expect(box).toBeFocused();
  await box.fill(text);
  if (how === 'ctrl-enter') await page.keyboard.press('Control+Enter');
  else await page.locator('[data-action="comment-save"]').click();
  await expect(page.locator('.cm-editor')).toHaveCount(0);
}

const bar = (page: Page) => page.locator('.cm-bar');
const pasted = (body: string) => START + body.replace(/\n/g, '\r') + END;

test('dos comentarios en archivos distintos se pegan juntos en la sesión, sin Enter', async () => {
  const dir = twoFileRepo();
  const run = await start(dir);
  try {
    const { page } = run;
    await expect(bar(page)).toHaveCount(0);
    await comment(page, 'src/b.txt', 5, 'Esto debería validar la entrada\ny también el caso vacío');
    await comment(page, 'a.txt', 3, 'Renombra esto', 'ctrl-enter');
    await expect(bar(page)).toHaveAttribute('data-comments', '2');
    await expect(bar(page).locator('.cm-count')).toHaveText('2 comentarios');
    if (process.env.HILO_SHOTS_DIR) await page.screenshot({ path: join(process.env.HILO_SHOTS_DIR, 'comentarios-barra.png') });
    await expect(lineButton(page, 3)).toHaveClass(/has/);
    await expect(page.locator('[data-field="comment-target"]')).toHaveValue(A);
    // Nada llega a la sesión hasta que se pide.
    await settle();
    expect(readSink(run.sinkFile).length).toBe(0);

    await page.locator('[data-action="comments-send"]').click();
    const want = pasted('a.txt:3: Renombra esto\n    `` alfa tres `cambiada` ``\nsrc/b.txt:5: Esto debería validar la entrada\n    y también el caso vacío\n    `beta cinco cambiada`');
    // Primero se espera lo que se pegó: un buffer vacío no debe dar por buena la comparación.
    const got = await waitForSink(run.sinkFile, (b) => b.includes(END));
    expect(got.toString('utf8')).toBe(want);
    // Sin Enter: lo último es el cierre del bracketed paste.
    await settle(400);
    expect(readSink(run.sinkFile).toString('utf8')).toBe(want);
    // Lo enviado ya no está pendiente.
    await expect(bar(page)).toHaveCount(0);
    await expect(lineButton(page, 3)).not.toHaveClass(/has/);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('cancelar, Esc, Quitar y Descartar no pegan nada', async () => {
  const dir = twoFileRepo();
  const run = await start(dir);
  try {
    const { page } = run;
    await fileRow(page, 'a.txt').click();
    // Cancelar con el botón.
    await lineButton(page, 3).click();
    await page.locator('.cm-editor textarea').fill('no lo guardes');
    if (process.env.HILO_SHOTS_DIR) await page.screenshot({ path: join(process.env.HILO_SHOTS_DIR, 'comentarios-editor.png') });
    await page.locator('[data-action="comment-cancel"]').click();
    await expect(page.locator('.cm-editor')).toHaveCount(0);
    await expect(bar(page)).toHaveCount(0);
    // Con Esc.
    await lineButton(page, 4).click();
    await page.locator('.cm-editor textarea').fill('tampoco');
    await page.keyboard.press('Escape');
    await expect(page.locator('.cm-editor')).toHaveCount(0);
    await expect(bar(page)).toHaveCount(0);
    // Guardar uno vacío no se puede.
    await lineButton(page, 4).click();
    await expect(page.locator('[data-action="comment-save"]')).toBeDisabled();
    await page.keyboard.press('Escape');

    // Quitar el de una línea.
    await comment(page, 'a.txt', 3, 'uno');
    await expect(bar(page)).toHaveAttribute('data-comments', '1');
    await lineButton(page, 3).click();
    await expect(page.locator('.cm-editor textarea')).toHaveValue('uno');
    await page.locator('[data-action="comment-remove"]').click();
    await expect(bar(page)).toHaveCount(0);

    // Descartar todos.
    await comment(page, 'a.txt', 3, 'uno');
    await comment(page, 'a.txt', 4, 'dos');
    await expect(bar(page).locator('.cm-count')).toHaveText('2 comentarios');
    await page.locator('[data-action="comments-discard"]').click();
    await expect(bar(page)).toHaveCount(0);

    await settle(400);
    expect(readSink(run.sinkFile).length).toBe(0);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('recargar el diff, cambiar de archivo o cerrar el panel conserva los comentarios', async () => {
  const dir = twoFileRepo();
  const run = await start(dir);
  try {
    const { page } = run;
    await comment(page, 'a.txt', 3, 'sigo aquí');
    await expect(bar(page)).toHaveAttribute('data-comments', '1');

    // Actualizar con el archivo cambiado en disco.
    const a = lines('alfa');
    a[2] = 'alfa tres `cambiada`';
    a[8] = 'alfa nueve tocada';
    write(dir, 'a.txt', a);
    await page.locator('.changes-refresh').click();
    await expect(page.locator('.changes')).toHaveAttribute('data-busy', 'false');
    await expect(page.locator('.dr-code', { hasText: 'alfa nueve tocada' })).toBeVisible();
    await expect(lineButton(page, 3)).toHaveClass(/has/);
    await expect(bar(page)).toHaveAttribute('data-comments', '1');

    // Otro archivo y de vuelta.
    await fileRow(page, 'src/b.txt').click();
    await expect(page.locator('.changes-path')).toHaveText('src/b.txt');
    await expect(bar(page)).toHaveAttribute('data-comments', '1');
    await fileRow(page, 'a.txt').click();
    await expect(lineButton(page, 3)).toHaveClass(/has/);

    // Cerrar y volver a abrir el panel.
    await page.locator('[data-action="toggle-changes"]').click();
    await expect(page.locator('.changes')).toHaveCount(0);
    await page.locator('[data-action="toggle-changes"]').click();
    await expect(page.locator('.changes')).toHaveAttribute('data-status', 'ok');
    await expect(bar(page)).toHaveAttribute('data-comments', '1');

    // El archivo ya no tiene cambios: el comentario se conserva por ruta, se avisa y aun así se puede enviar.
    git(dir, 'checkout', '--', 'a.txt');
    await page.locator('.changes-refresh').click();
    await expect(fileRow(page, 'a.txt')).toHaveCount(0);
    await expect(bar(page).locator('.cm-count')).toContainText('es de un archivo que ya no aparece en Cambios');
    await page.locator('[data-action="comments-send"]').click();
    const got = await waitForSink(run.sinkFile, (b) => b.includes(END));
    expect(got.toString('utf8')).toBe(pasted('a.txt:3: sigo aquí\n    `` alfa tres `cambiada` ``'));
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('Ctrl+Intro dentro del panel envía; con el panel sin comentarios no hace nada', async () => {
  const dir = twoFileRepo();
  const run = await start(dir);
  try {
    const { page } = run;
    await fileRow(page, 'a.txt').focus();
    await page.keyboard.press('Control+Enter');
    await settle(300);
    expect(readSink(run.sinkFile).length).toBe(0);

    await comment(page, 'a.txt', 3, 'por teclado');
    await fileRow(page, 'a.txt').focus();
    await page.keyboard.press('Control+Enter');
    const got = await waitForSink(run.sinkFile, (b) => b.includes(END));
    expect(got.toString('utf8')).toBe(pasted('a.txt:3: por teclado\n    `` alfa tres `cambiada` ``'));
    await expect(bar(page)).toHaveCount(0);
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});

test('sin sesiones despiertas no se puede enviar y los comentarios quedan', async () => {
  const dir = twoFileRepo();
  const state = makeState([{ id: A, name: 'Uno' }], dir);
  state.ui = { ...state.ui, activeSessionId: A, panes: [A], layout: 1, activePane: 0 };
  state.settings.wakeOnSelect = false;
  const run = await launch({ state, width: 1400, height: 860 });
  try {
    const { page } = run;
    await page.locator('[data-action="toggle-changes"]').click();
    await expect(page.locator('.changes')).toHaveAttribute('data-status', 'ok');
    await comment(page, 'a.txt', 3, 'esperando');
    await expect(bar(page).locator('.cm-none')).toBeVisible();
    await expect(page.locator('[data-action="comments-send"]')).toBeDisabled();
    await expect(bar(page)).toHaveAttribute('data-comments', '1');
  } finally {
    await run.close();
    cleanup(run.dataDir);
  }
});
