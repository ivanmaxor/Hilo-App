import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shellReference } from '../../src/shared/dropPaths';
import { cleanup, clearSink, focusTerm, launch, makeState, openSink, readSink, settle, waitForSink, type Launched } from './helpers';

// Estas sesiones son PowerShell (las de Claude necesitan Claude real): pegan la ruta completa. El `@ruta` de Claude
// lo prueban las unitarias de `dropPaths` y, con Claude real, `claude-arrastrar-espacios.spec.ts`.

const ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SLEEPING = 'aaaaaaaa-0000-4000-8000-000000000002';
const START = '\x1b[200~';
const END = '\x1b[201~';

/**
 * Playwright no puede arrastrar desde el Explorador de Windows. Aquí los File son reales (salen de un
 * <input type="file"> con archivos de disco, así que `webUtils.getPathForFile` devuelve su ruta) y el
 * evento `drop` se despacha a mano sobre la terminal. El gesto con el ratón desde el Explorador queda sin verificar.
 */
async function drop(ctx: Launched, target: 'term' | 'overlay', id: string, files: string[]): Promise<{ prevented: boolean; types: string[] }> {
  await ctx.page.evaluate(() => {
    document.getElementById('prueba-archivos')?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'prueba-archivos';
    document.body.appendChild(input);
  });
  if (files.length) await ctx.page.locator('#prueba-archivos').setInputFiles(files);
  return ctx.page.evaluate(
    ([where, sid]) => {
      const input = document.getElementById('prueba-archivos') as HTMLInputElement;
      const dt = new DataTransfer();
      for (const f of Array.from(input.files ?? [])) dt.items.add(f);
      const el = where === 'term' ? ((window as any).__hiloTest.terminals.debugEntry(sid).term.element.querySelector('.xterm-screen') as HTMLElement) : (document.querySelector('.overlay') as HTMLElement);
      const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(over);
      const event = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return { prevented: event.defaultPrevented && over.defaultPrevented, types: Array.from(dt.types) };
    },
    [target, id] as const,
  );
}

test.describe('arrastrar archivos a una sesión', () => {
  test.describe.configure({ mode: 'serial' });
  let ctx: Launched;
  let root: string;
  let project: string;
  let outside: string;

  test.beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'hilo-drop-'));
    project = join(root, 'proyecto');
    outside = join(root, 'fuera');
    mkdirSync(join(project, 'sub dir'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(project, 'a.txt'), 'a');
    writeFileSync(join(project, 'sub dir', 'con espacio.txt'), 'b');
    writeFileSync(join(outside, 'otro.txt'), 'c');
    writeFileSync(join(outside, 'otro con espacio.txt'), 'd');
    for (let i = 0; i < 21; i++) writeFileSync(join(project, `f${String(i).padStart(2, '0')}.txt`), 'x');
    ctx = await launch({ state: makeState([{ id: ID, name: 'despierta' }, { id: SLEEPING, name: 'dormida' }], project) });
    await openSink(ctx.page, ID);
  });
  test.afterAll(async () => {
    await ctx.close();
    cleanup(ctx.dataDir);
    rmSync(root, { recursive: true, force: true });
  });
  test.beforeEach(async () => {
    clearSink(ctx.sinkFile);
    await ctx.page.evaluate((id) => (window as any).__hiloTest.selectSession(id), ID);
    await focusTerm(ctx.page, ID);
  });

  test('pathsOfFiles del preload devuelve la ruta real y no lanza con lo que no es un archivo', async () => {
    await ctx.page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = 'prueba-archivos';
      document.body.appendChild(input);
    });
    await ctx.page.locator('#prueba-archivos').setInputFiles(join(project, 'a.txt'));
    const got = await ctx.page.evaluate(() => {
      const input = document.getElementById('prueba-archivos') as HTMLInputElement;
      const api = (window as any).hilo;
      return {
        fromList: api.pathsOfFiles(input.files),
        fromArray: api.pathsOfFiles(Array.from(input.files!)),
        constructed: api.pathsOfFiles([new File(['x'], 'inventado.txt')]),
        notFiles: api.pathsOfFiles([{ path: 'C:\\falso.txt' }, 'C:\\falso.txt', null]),
        nothing: api.pathsOfFiles(undefined),
      };
    });
    // Un FileList no cruza el puente de contexto: por eso el renderer pasa un arreglo.
    expect(got.fromList).toEqual([]);
    expect(got.fromArray).toEqual([join(project, 'a.txt')]);
    expect(got.constructed).toEqual([]);
    expect(got.notFiles).toEqual([]);
    expect(got.nothing).toEqual([]);
  });

  test('un archivo dentro de la carpeta de una PowerShell pega su ruta completa, sin @ ni Enter', async () => {
    const r = await drop(ctx, 'term', ID, [join(project, 'a.txt')]);
    expect(r.types).toContain('Files');
    expect(r.prevented).toBe(true);
    const got = await waitForSink(ctx.sinkFile, (b) => b.includes(END));
    expect(got.toString('utf8')).toBe(`${START}${shellReference(join(project, 'a.txt'))}${END}`);
    expect(got.toString('utf8')).not.toContain('@');
    expect(got.toString('utf8')).not.toContain('\r');
  });

  test('uno de fuera pega la ruta completa', async () => {
    await drop(ctx, 'term', ID, [join(outside, 'otro.txt')]);
    const got = await waitForSink(ctx.sinkFile, (b) => b.includes(END));
    expect(got.toString('utf8')).toBe(`${START}${shellReference(join(outside, 'otro.txt'))}${END}`);
  });

  test('varios, con espacios en el nombre, van separados por un espacio y entre comillas simples', async () => {
    const files = [join(project, 'a.txt'), join(project, 'sub dir', 'con espacio.txt'), join(outside, 'otro con espacio.txt')];
    await drop(ctx, 'term', ID, files);
    const got = await waitForSink(ctx.sinkFile, (b) => b.includes(END));
    expect(got.toString('utf8')).toBe(`${START}${files.map(shellReference).join(' ')}${END}`);
    expect(got.toString('utf8')).toContain(`'${join(project, 'sub dir', 'con espacio.txt')}'`);
  });

  test('con más de 20 se pegan 20 y se avisa', async () => {
    const all = Array.from({ length: 21 }, (_, i) => join(project, `f${String(i).padStart(2, '0')}.txt`));
    await drop(ctx, 'term', ID, all);
    const got = await waitForSink(ctx.sinkFile, (b) => b.includes(END));
    const text = got.toString('utf8');
    expect(text.slice(START.length, -END.length).split(' ')).toHaveLength(20);
    expect(text).toContain('f19.txt');
    expect(text).not.toContain('f20');
    await expect(ctx.page.locator('.toast').last()).toContainText('Solo se pegan 20');
  });

  test('un arrastre sin archivos (el de reordenar sesiones) no se toca', async () => {
    const got = await ctx.page.evaluate((id) => {
      const el = (window as any).__hiloTest.terminals.debugEntry(id).term.element.querySelector('.xterm-screen') as HTMLElement;
      const dt = new DataTransfer();
      dt.setData('text/plain', 'x');
      const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(over);
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return { over: over.defaultPrevented };
    }, ID);
    // El panel ya llama a preventDefault en cualquier drop: lo que importa es que dragover quede libre para el arrastre interno.
    expect(got.over).toBe(false);
    await settle();
    expect(readSink(ctx.sinkFile).length).toBe(0);
  });

  test('soltar fuera de las terminales no navega ni pega', async () => {
    const urlBefore = ctx.page.url();
    const prevented = await ctx.page.evaluate(() => {
      const input = document.getElementById('prueba-archivos') as HTMLInputElement;
      const dt = new DataTransfer();
      for (const f of Array.from(input.files ?? [])) dt.items.add(f);
      const event = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(true);
    await settle();
    expect(ctx.page.url()).toBe(urlBefore);
    expect(readSink(ctx.sinkFile).length).toBe(0);
  });

  test('sobre una sesión dormida solo se avisa: no se despierta ni se pega', async () => {
    // Con dispatch directo: selectSession despertaría la sesión.
    await ctx.page.evaluate((id) => (window as any).hilo.dispatch({ type: 'ui/select', id }), SLEEPING);
    await expect(ctx.page.locator('.overlay')).toContainText('Dormida');
    await drop(ctx, 'overlay', SLEEPING, [join(project, 'a.txt')]);
    await expect(ctx.page.locator('.toast').last()).toContainText('dormida');
    await settle(500);
    expect(await ctx.page.evaluate((id) => (window as any).__hiloTest.app.get().runtime[id]?.status ?? 'asleep', SLEEPING)).toBe('asleep');
    expect(readSink(ctx.sinkFile).length).toBe(0);
  });
});
