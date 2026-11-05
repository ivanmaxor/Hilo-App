/**
 * Auditoría A5 (ronda 4): versión futura, copia .bak y máquina de estados contra las grabaciones.
 * Solo con HILO_AUDIT=1: afirman lo correcto, y `npm test` tiene que seguir en verde mientras no se arregle.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultState } from '../../src/shared/defaults';
import { classifyTitle, OscTitleScanner } from '../../src/shared/oscScanner';
import { initialState, transition, type MachineState } from '../../src/shared/statusMachine';
import { Store } from '../../src/main/store';

const audit = describe.skipIf(!process.env.HILO_AUDIT);
const dirs: string[] = [];
function dir(): string {
  const d = mkdtempSync(join(tmpdir(), 'a5r4-store-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const withFont = (fontSize: number, version = 1) => ({ ...defaultState(), version, settings: { ...defaultState().settings, fontSize } });

audit('versión futura y copia', () => {
  it('versión futura con copia válida: recupera la copia y conserva el archivo aparte', () => {
    const d = dir();
    const future = JSON.stringify({ ...withFont(30, 99), campoNuevo: 1 });
    writeFileSync(join(d, 'state.json'), future);
    writeFileSync(join(d, 'state.json.bak'), JSON.stringify(withFont(12)));
    const s = new Store(d);
    expect(s.get().settings.fontSize).toBe(12);
    expect(s.notice).toContain('versión más nueva');
    const aside = readdirSync(d).find((f) => f.includes('.corrupto-'))!;
    expect(readFileSync(join(d, aside), 'utf8')).toBe(future);
    // El primer guardado no toca nada de lo anterior.
    s.dispatch({ type: 'settings/set', patch: { fontSize: 13 } });
    s.flush();
    expect(JSON.parse(readFileSync(join(d, 'state.json.bak'), 'utf8')).settings.fontSize).toBe(12);
    expect(JSON.parse(readFileSync(join(d, 'state.json'), 'utf8')).settings.fontSize).toBe(13);
  });

  it('una copia de una versión futura no se pisa: es lo único que queda de esos datos', () => {
    const d = dir();
    const futureBak = JSON.stringify(withFont(30, 99));
    writeFileSync(join(d, 'state.json'), '{ dañado');
    writeFileSync(join(d, 'state.json.bak'), futureBak);
    const s = new Store(d);
    expect(s.get().projects).toEqual([]);
    s.dispatch({ type: 'settings/set', patch: { fontSize: 13 } });
    s.flush();
    s.dispatch({ type: 'settings/set', patch: { fontSize: 14 } });
    s.flush();
    expect(readFileSync(join(d, 'state.json.bak'), 'utf8')).toBe(futureBak);
  });

  it('flush con saveBlocked: no toca el disco, no lanza, y flushSafe no programa reintentos', () => {
    const d = dir();
    const s = new Store(d);
    (s as unknown as { saveBlocked: boolean }).saveBlocked = true;
    s.dispatch({ type: 'settings/set', patch: { fontSize: 13 } });
    expect(s.flushSafe()).toBe(true);
    expect((s as unknown as { timer: unknown }).timer).toBe(null);
    expect(existsSync(join(d, 'state.json'))).toBe(false);
  });
});

interface Line {
  t?: number;
  data?: string;
  sessfile?: { status?: string };
  exit?: number;
}

/** Igual que SessionController.onRaw: el texto del diálogo de confianza dispara `startTimeout`. */
function replay(name: string): { status: string; blocked: boolean; seen: string[] } {
  const file = join(__dirname, '..', '..', 'docs', 'investigacion', 'fixtures', name);
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line);
  const scanner = new OscTitleScanner();
  let s: MachineState = transition(initialState('claude'), { t: 'spawn' }, 0);
  let tail = '';
  const seen: string[] = [s.status];
  const note = () => {
    const tag = `${s.status}${s.blockedAtStart ? '*' : ''}`;
    if (seen[seen.length - 1] !== tag) seen.push(tag);
  };
  for (const l of lines) {
    const t = l.t ?? 0;
    if (l.data !== undefined) {
      if (tail.length < 16_384) {
        tail += l.data;
        // eslint-disable-next-line no-control-regex
        const clean = tail.replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, '');
        if (s.status === 'starting' && clean.includes('trust this folder')) s = transition(s, { t: 'startTimeout' }, t);
        note();
      }
      for (const title of scanner.feed(l.data)) {
        s = transition(s, { t: 'title', kind: classifyTitle(title) }, t);
        note();
      }
    }
    const st = l.sessfile?.status;
    if (st === 'busy' || st === 'idle' || st === 'waiting') {
      s = transition(s, { t: 'sessionFile', status: st }, t);
      note();
    }
    if (l.exit !== undefined) {
      s = transition(s, { t: 'exit', code: l.exit, requested: false }, t);
      note();
    }
  }
  return { status: s.status, blocked: !!s.blockedAtStart, seen };
}

audit('blockedAtStart contra las grabaciones', () => {
  it('arranque: el diálogo de confianza es "esperando", y al aceptarlo pasa a lista', () => {
    const r = replay('arranque.jsonl');
    console.log(`[arranque] ${r.seen.join(' > ')}`);
    expect(r.seen).toContain('waiting*');
    const at = r.seen.indexOf('waiting*');
    expect(r.seen[at + 1]).toBe('idle');
  });

  for (const name of readdirSync(join(__dirname, '..', '..', 'docs', 'investigacion', 'fixtures')).filter((f) => !f.startsWith('calibracion'))) {
    it(`${name}: ningún "esperando" real queda marcado como del arranque`, () => {
      const r = replay(name);
      console.log(`[${name}] ${r.seen.join(' > ')}`);
      const start = r.seen.indexOf('waiting*');
      const afterStart = start >= 0 ? r.seen.slice(start + 1) : r.seen;
      expect(afterStart).not.toContain('waiting*');
      // Toda espera sale con el archivo de sesión (Esc) o con el título al seguir trabajando.
      if (name === 'permiso.jsonl' || name === 'pregunta.jsonl') {
        expect(r.seen).toContain('waiting');
        expect(r.seen[r.seen.indexOf('waiting') + 1]).toBe('idle');
      }
    });
  }
});
