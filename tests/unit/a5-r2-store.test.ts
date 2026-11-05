/**
 * Auditoría A5 (ronda 2): guardado y máquina de estados. Afirman lo CORRECTO: si fallan, está reproducido.
 * Solo con HILO_AUDIT=1: fallan a propósito mientras los fallos sigan sin arreglar, y `npm test` tiene que seguir en verde.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Store } from '../../src/main/store';
import { OscTitleScanner, classifyTitle } from '../../src/shared/oscScanner';
import { initialState, transition, type MachineEvent } from '../../src/shared/statusMachine';

function dir(): string {
  return mkdtempSync(join(process.env.A5R2_DIR ?? tmpdir(), 'a5r2-store-'));
}

const audit = describe.skipIf(!process.env.HILO_AUDIT);

audit('state.json de otra versión o con otra forma', () => {
  it('una versión futura no se pisa en silencio', () => {
    const d = dir();
    const future = { version: 2, workspaces: [{ id: 'w1', name: 'Mi trabajo', sessions: [{ id: 's1', cwd: 'C:\\x' }] }] };
    writeFileSync(join(d, 'state.json'), JSON.stringify(future));
    const store = new Store(d);
    console.log(`[versión futura] proyectos=${store.get().projects.length} aviso=${store.notice}`);
    store.dispatch({ type: 'ui/sidebar', collapsed: true });
    store.flush();
    store.dispatch({ type: 'ui/sidebar', collapsed: false });
    store.flush();
    const files = readdirSync(d);
    const survives = files.some((f) => readFileSync(join(d, f), 'utf8').includes('Mi trabajo'));
    console.log(`[versión futura] archivos=${files.join(',')} datos originales en disco=${survives}`);
    rmSync(d, { recursive: true, force: true });
    expect(survives).toBe(true);
  });

  it('un archivo válido pero sin proyectos utilizables avisa', () => {
    const d = dir();
    // JSON correcto, pero `projects` no es una lista: por ejemplo, una edición a mano mal hecha.
    writeFileSync(join(d, 'state.json'), JSON.stringify({ version: 1, projects: { a: 1 } }));
    const store = new Store(d);
    const notice = store.notice;
    rmSync(d, { recursive: true, force: true });
    expect(notice).not.toBeNull();
  });
});

audit('guardado que falla', () => {
  it('se reintenta aunque no haya otro cambio: lo promete el aviso', async () => {
    const d = dir();
    const store = new Store(d);
    // El temporal es una carpeta: la escritura falla.
    mkdirSync(join(d, 'state.json.tmp'));
    store.dispatch({ type: 'ui/sidebar', collapsed: true });
    expect(store.flushSafe()).toBe(false);
    rmSync(join(d, 'state.json.tmp'), { recursive: true });
    await new Promise((r) => setTimeout(r, 1500));
    const saved = existsSync(join(d, 'state.json'));
    rmSync(d, { recursive: true, force: true });
    expect(saved).toBe(true);
  });
});

audit('máquina de estados', () => {
  const run = (events: [MachineEvent, number?][]) => {
    let s = transition(initialState('claude'), { t: 'spawn' }, 0);
    for (const [ev, t] of events) s = transition(s, ev, t ?? 0);
    return s.status;
  };

  it('tras el diálogo de confianza, ✳ sin archivo de sesión no deja "esperando" para siempre', () => {
    expect(run([[{ t: 'startTimeout' }], [{ t: 'title', kind: 'ready' }]])).not.toBe('waiting');
  });

  it('un OSC abortado no cuenta como título', () => {
    // El comentario de findTerminator dice "OSC abortado, el contenido no sirve".
    const titles = new OscTitleScanner().feed('\x1b]0;◐ a medias\x1b[0m');
    expect(titles.map(classifyTitle)).toEqual([]);
  });
});
