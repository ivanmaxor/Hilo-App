import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyTitle, OscTitleScanner } from '../../src/shared/oscScanner';
import { initialState, transition, type MachineEvent, type MachineState } from '../../src/shared/statusMachine';

const FIXTURES = join(__dirname, '..', '..', 'docs', 'investigacion', 'fixtures');

interface Line {
  t?: number;
  data?: string;
  sessfile?: { status?: string };
  exit?: number;
}

function load(name: string): Line[] {
  return readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Line);
}

function chunks(name: string): string[] {
  return load(name).flatMap((l) => (l.data !== undefined ? [l.data] : []));
}

/** Pasa una grabación por el escáner y la máquina, y devuelve los estados por los que pasó. */
function replay(name: string, opts: { sessionFile?: boolean } = {}): string[] {
  const scanner = new OscTitleScanner();
  let s: MachineState = transition(initialState('claude'), { t: 'spawn' }, 0);
  const seen = [s.status as string];
  const apply = (ev: MachineEvent, t: number) => {
    s = transition(s, ev, t);
    if (seen[seen.length - 1] !== s.status) seen.push(s.status);
  };
  for (const line of load(name)) {
    const t = line.t ?? 0;
    if (line.data !== undefined) {
      for (const title of scanner.feed(line.data)) apply({ t: 'title', kind: classifyTitle(title) }, t);
    }
    const st = line.sessfile?.status;
    if (opts.sessionFile && (st === 'busy' || st === 'idle' || st === 'waiting')) apply({ t: 'sessionFile', status: st }, t);
    if (line.exit !== undefined) apply({ t: 'exit', code: line.exit, requested: false }, t);
  }
  return seen;
}

describe('OscTitleScanner', () => {
  it('lee títulos con ST y con BEL', () => {
    const scanner = new OscTitleScanner();
    expect(scanner.feed('\x1b]0;uno\x1b\\texto\x1b]2;dos\x07')).toEqual(['uno', 'dos']);
  });

  it('ignora otros OSC', () => {
    const scanner = new OscTitleScanner();
    expect(scanner.feed('\x1b]9;4;3;\x07\x1b]8;;http://x\x1b\\\x1b]7;file://x\x07')).toEqual([]);
  });

  it('funciona con el flujo partido en cualquier punto', () => {
    const data = 'abc\x1b]0;◐ Título largo\x1b\\def\x1b]0;✳ Listo\x07ghi';
    for (let i = 0; i <= data.length; i++) {
      const scanner = new OscTitleScanner();
      const titles = [...scanner.feed(data.slice(0, i)), ...scanner.feed(data.slice(i))];
      expect(titles).toEqual(['◐ Título largo', '✳ Listo']);
    }
  });

  it('descarta secuencias sin terminador demasiado largas', () => {
    const scanner = new OscTitleScanner();
    expect(scanner.feed(`\x1b]0;${'x'.repeat(5000)}`)).toEqual([]);
    expect(scanner.feed('\x1b]0;ok\x07')).toEqual(['ok']);
  });

  it('coincide con los títulos reales grabados, byte a byte o en trozos', () => {
    for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith('.jsonl') && !f.startsWith('calibracion'))) {
      const parts = chunks(file);
      const whole = new OscTitleScanner().feed(parts.join(''));
      const scanner = new OscTitleScanner();
      expect(parts.flatMap((p) => scanner.feed(p)), file).toEqual(whole);
      const single = new OscTitleScanner();
      const byChar = Array.from(parts.join('')).flatMap((c) => single.feed(c));
      expect(byChar, file).toEqual(whole);
    }
  });
});

describe('classifyTitle', () => {
  it('reconoce los glifos reales', () => {
    expect(classifyTitle('◐ Respuesta OK')).toBe('working');
    expect(classifyTitle('◑ Respuesta OK')).toBe('working');
    expect(classifyTitle('✳ Claude Code')).toBe('ready');
    expect(classifyTitle('claude')).toBe('other');
    expect(classifyTitle('')).toBe('other');
  });
  it('tolera braille por si vuelve en otra versión', () => {
    expect(classifyTitle('⠋ algo')).toBe('working');
  });
});

describe('estados contra grabaciones reales de Claude Code 2.1.316', () => {
  it('arranque sin prompt: de arrancando a lista', () => {
    expect(replay('arranque.jsonl')).toContain('idle');
    expect(replay('arranque.jsonl')).not.toContain('working');
  });

  it('turno completo: trabajando y luego verde', () => {
    const states = replay('trabajando-y-listo-dll.jsonl');
    const w = states.indexOf('working');
    expect(w).toBeGreaterThan(-1);
    expect(states[w + 1]).toBe('done');
  });

  it('el mismo turno por ConPTY del sistema da lo mismo', () => {
    const states = replay('trabajando-y-listo.jsonl');
    expect(states.slice(states.indexOf('working'), states.indexOf('working') + 2)).toEqual(['working', 'done']);
  });

  it('un permiso solo es visible con el archivo de sesión o con hooks', () => {
    const noFile = replay('permiso.jsonl');
    expect(noFile).not.toContain('waiting');
    const withFile = replay('permiso.jsonl', { sessionFile: true });
    expect(withFile).toContain('waiting');
  });

  it('una muerte por kill queda en error', () => {
    const states = replay('salida-taskkill.jsonl');
    expect(states[states.length - 1]).toBe('error');
  });

  it('salir con Ctrl+C dos veces queda dormida', () => {
    const states = replay('salida-ctrlc.jsonl');
    expect(states[states.length - 1]).toBe('asleep');
  });

  it('retomar conserva el comportamiento del título', () => {
    expect(replay('resume.jsonl')).toContain('idle');
  });
});

describe('statusMachine', () => {
  const run = (events: [MachineEvent, number?][], kind: 'claude' | 'shell' = 'claude') => {
    let s = transition(initialState(kind), { t: 'spawn' }, 0);
    for (const [ev, t] of events) s = transition(s, ev, t ?? 0);
    return s.status;
  };

  it('el hook Stop adelanta el verde aunque el título siga en ◐', () => {
    expect(
      run([
        [{ t: 'title', kind: 'ready' }],
        [{ t: 'title', kind: 'working' }],
        [{ t: 'hook', name: 'Stop' }, 1000],
        [{ t: 'title', kind: 'working' }, 2000],
      ]),
    ).toBe('done');
  });

  it('si un hook obliga a seguir, vuelve a trabajando al vencer el bloqueo', () => {
    expect(
      run([
        [{ t: 'title', kind: 'working' }],
        [{ t: 'hook', name: 'Stop' }, 1000],
        [{ t: 'title', kind: 'working' }, 30_000],
      ]),
    ).toBe('working');
  });

  it('✳ no saca de esperando', () => {
    expect(
      run([
        [{ t: 'title', kind: 'working' }],
        [{ t: 'hook', name: 'PermissionRequest' }],
        [{ t: 'title', kind: 'ready' }],
      ]),
    ).toBe('waiting');
  });

  it('aprobar un permiso vuelve a trabajando', () => {
    expect(
      run([
        [{ t: 'hook', name: 'PermissionRequest' }],
        [{ t: 'title', kind: 'working' }],
      ]),
    ).toBe('working');
  });

  it('Esc en un permiso: el archivo de sesión lo saca de esperando, sin marcar no leído', () => {
    expect(
      run([
        [{ t: 'hook', name: 'PermissionRequest' }],
        [{ t: 'sessionFile', status: 'idle' }],
      ]),
    ).toBe('idle');
  });

  it('título congelado sin foco: el archivo de sesión termina el turno', () => {
    expect(
      run([
        [{ t: 'title', kind: 'working' }],
        [{ t: 'sessionFile', status: 'idle' }],
      ]),
    ).toBe('done');
  });

  it('el verde pasa a neutro solo al verlo', () => {
    expect(
      run([
        [{ t: 'title', kind: 'working' }],
        [{ t: 'title', kind: 'ready' }],
      ]),
    ).toBe('done');
    expect(
      run([
        [{ t: 'title', kind: 'working' }],
        [{ t: 'title', kind: 'ready' }],
        [{ t: 'viewed' }],
      ]),
    ).toBe('idle');
  });

  it('salida limpia queda dormida; con error queda en rojo; pedida queda dormida', () => {
    expect(run([[{ t: 'exit', code: 0, requested: false }]])).toBe('asleep');
    expect(run([[{ t: 'exit', code: 1, requested: false }]])).toBe('error');
    expect(run([[{ t: 'exit', code: 1, requested: true }]])).toBe('asleep');
  });

  it('el diálogo de confianza acaba en esperando', () => {
    expect(run([[{ t: 'startTimeout' }]])).toBe('waiting');
    expect(run([[{ t: 'title', kind: 'ready' }], [{ t: 'startTimeout' }]])).toBe('idle');
  });

  it('una shell no usa el título ni la señal de trabajo', () => {
    expect(run([[{ t: 'title', kind: 'working' }]], 'shell')).toBe('idle');
    expect(run([[{ t: 'exit', code: 1, requested: false }]], 'shell')).toBe('exited');
  });

  it('los eventos tardíos no reviven una sesión muerta', () => {
    expect(
      run([
        [{ t: 'exit', code: 1, requested: false }],
        [{ t: 'title', kind: 'working' }],
        [{ t: 'hook', name: 'Stop' }],
      ]),
    ).toBe('error');
  });
});

describe('subagentes en segundo plano', () => {
  const hook = (name: Parameters<typeof transition>[1] extends infer E ? (E extends { t: 'hook'; name: infer N } ? N : never) : never): MachineEvent => ({ t: 'hook', name });
  const run = (events: MachineEvent[], from?: MachineState) => {
    let s = from ?? transition(initialState('claude'), { t: 'spawn' }, 0);
    const seen: string[] = [];
    let now = 1000;
    for (const ev of events) {
      s = transition(s, ev, (now += 1000));
      seen.push(s.status);
    }
    return { s, seen };
  };

  it('el orden grabado con Claude real: solo termina cuando acaba el último', () => {
    const { s, seen } = run([
      hook('UserPromptSubmit'),
      hook('SubagentStart'),
      hook('SubagentStart'),
      hook('Stop'),
      hook('SubagentStop'),
      hook('UserPromptSubmit'),
      hook('Stop'),
      hook('UserPromptSubmit'),
      hook('Stop'),
      hook('SubagentStop'),
      hook('UserPromptSubmit'),
    ]);
    expect(seen).not.toContain('done');
    expect(s.subagents).toBe(0);
    expect(run([hook('Stop')], s).s.status).toBe('done');
  });

  it('el título en listo no la da por terminada mientras queden', () => {
    const { s } = run([hook('UserPromptSubmit'), hook('SubagentStart'), { t: 'title', kind: 'ready' }]);
    expect(s.status).toBe('working');
    expect(s.subagents).toBe(1);
  });

  it('un subagente en primer plano no cambia nada: Stop termina igual', () => {
    const { s } = run([hook('UserPromptSubmit'), hook('SubagentStart'), hook('SubagentStop'), hook('Stop')]);
    expect(s.status).toBe('done');
  });

  it('si Claude dice idle no queda ninguno, aunque se perdiera un SubagentStop', () => {
    const { s } = run([hook('UserPromptSubmit'), hook('SubagentStart'), hook('Stop'), { t: 'sessionFile', status: 'idle' }]);
    expect(s.status).toBe('done');
    expect(s.subagents).toBe(0);
  });

  it('un SubagentStop sin Start no deja la cuenta negativa', () => {
    const { s } = run([hook('UserPromptSubmit'), hook('SubagentStop'), hook('Stop')]);
    expect(s.subagents).toBe(0);
    expect(s.status).toBe('done');
  });

  it('un permiso pendiente sigue esperando aunque termine el principal', () => {
    const { s } = run([hook('UserPromptSubmit'), hook('SubagentStart'), hook('PermissionRequest'), hook('Stop')]);
    expect(s.status).toBe('waiting');
  });

  it('un subagente que retoma despierta la sesión ya terminada', () => {
    const { s } = run([hook('UserPromptSubmit'), hook('Stop'), hook('SubagentStart')]);
    expect(s.status).toBe('working');
  });

  it('dormir o reabrir borra la cuenta', () => {
    const { s } = run([hook('UserPromptSubmit'), hook('SubagentStart'), { t: 'sleep' }]);
    expect(s.subagents).toBeUndefined();
  });
});
