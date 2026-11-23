import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transcriptExists, transcriptMtime } from '../../src/main/claude';
import { findSession, reduce } from '../../src/shared/reducer';
import type { PersistedState } from '../../src/shared/types';

/** #6: Claude retoma por id desde cualquier carpeta, así que Hilo solo comprueba que el historial exista. */
describe('historial buscado por id en todas las carpetas', () => {
  const id = '3f2a9c1e-7b4d-4e8a-9a51-0c6d2b7e1f44';
  let config: string;
  let before: string | undefined;

  const slug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const saveTranscript = (cwd: string, claudeId = id) => {
    const dir = join(config, 'projects', slug(cwd));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${claudeId}.jsonl`), '{"type":"user"}\n');
  };

  beforeEach(() => {
    config = mkdtempSync(join(tmpdir(), 'hilo-claude-'));
    before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = config;
  });
  afterEach(() => {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    rmSync(config, { recursive: true, force: true });
  });

  it('lo encuentra en la carpeta de la sesión', () => {
    saveTranscript('D:\\Proyectos\\Nuevo');
    expect(transcriptExists('D:\\Proyectos\\Nuevo', id)).toBe(true);
  });

  it('lo encuentra aunque la sesión ahora esté en otra carpeta', () => {
    saveTranscript('D:\\Proyectos\\Viejo');
    expect(transcriptExists('D:\\Proyectos\\Nuevo', id)).toBe(true);
    expect(transcriptMtime('D:\\Proyectos\\Nuevo', id)).toBeTypeOf('number');
  });

  it('lo encuentra aunque la carpeta de la sesión ya no exista en el disco', () => {
    saveTranscript('Z:\\disco\\que\\ya\\no\\esta');
    expect(transcriptExists('D:\\Proyectos\\Nuevo', id)).toBe(true);
  });

  it('al arrancar (sin escanear) solo mira la carpeta de la sesión', () => {
    saveTranscript('D:\\Proyectos\\Viejo');
    expect(transcriptMtime('D:\\Proyectos\\Nuevo', id, false)).toBeNull();
    expect(transcriptMtime('D:\\Proyectos\\Viejo', id, false)).toBeTypeOf('number');
  });

  it('no lo confunde con la conversación de otro id', () => {
    saveTranscript('D:\\Proyectos\\Viejo', '11111111-2222-4333-8444-555555555555');
    expect(transcriptExists('D:\\Proyectos\\Nuevo', id)).toBe(false);
    expect(transcriptMtime('D:\\Proyectos\\Nuevo', id)).toBeNull();
  });

  it('sin carpeta projects, o sin ninguna conversación, dice que no existe', () => {
    expect(transcriptExists('D:\\Proyectos\\Nuevo', id)).toBe(false);
    mkdirSync(join(config, 'projects'), { recursive: true });
    expect(transcriptExists('D:\\Proyectos\\Nuevo', id)).toBe(false);
  });

  it('un id que no es de Claude nunca sale a buscar rutas', () => {
    saveTranscript('D:\\Proyectos\\Viejo');
    for (const bad of ['', '..', '..\\..\\secreto', `${id}\\..\\${id}`, `${id}.jsonl`, 'x'.repeat(200)]) {
      expect(transcriptExists('D:\\Proyectos\\Nuevo', bad)).toBe(false);
    }
  });

  it('solo mira: no crea, no copia y no cambia nada en las carpetas de Claude', () => {
    saveTranscript('D:\\Proyectos\\Viejo');
    const listing = () => readdirSync(join(config, 'projects'), { recursive: true }).sort();
    const antes = listing();
    transcriptExists('D:\\Proyectos\\Nuevo', id);
    transcriptMtime('D:\\Proyectos\\Nuevo', id);
    expect(listing()).toEqual(antes);
  });
});

describe('cambiar la carpeta de una sesión (session/cwd)', () => {
  const sessionId = 'ses-1';
  const state = {
    projects: [
      {
        id: 'p1',
        name: 'P',
        path: 'D:\\Proyectos\\Nuevo',
        sessions: [{ id: sessionId, name: 'A', kind: 'claude', claudeId: '3f2a9c1e-7b4d-4e8a-9a51-0c6d2b7e1f44', cwd: 'D:\\Proyectos\\Viejo' }],
      },
    ],
  } as unknown as PersistedState;

  it('cambia solo la carpeta: el id de la conversación se queda igual', () => {
    const next = reduce(state, { type: 'session/cwd', id: sessionId, cwd: 'D:\\Proyectos\\Nuevo' });
    const s = findSession(next, sessionId)!.session;
    expect(s.cwd).toBe('D:\\Proyectos\\Nuevo');
    expect(s.claudeId).toBe('3f2a9c1e-7b4d-4e8a-9a51-0c6d2b7e1f44');
  });

  it('con la misma carpeta el contenido del estado queda igual', () => {
    expect(reduce(state, { type: 'session/cwd', id: sessionId, cwd: 'D:\\Proyectos\\Viejo' })).toEqual(state);
  });
});
