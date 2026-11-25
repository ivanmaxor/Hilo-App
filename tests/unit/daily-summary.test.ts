import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDailySummary, localDateStamp, startOfLocalDay } from '../../src/shared/dailySummary';
import { isSummaryText, MAX_SUMMARY_CHARS, saveSummaryFile, summaryFileName } from '../../src/main/summaryFile';
import type { ProjectRecord, RuntimeMap, SessionRecord, SessionStatus } from '../../src/shared/types';

const NOW = new Date(2026, 10, 23, 14, 5); // lunes 23 de noviembre de 2026, 14:05 locales
const at = (h: number, m = 0, dayOffset = 0) => new Date(2026, 10, 23 + dayOffset, h, m).getTime();

function session(id: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return { id, claudeId: id, kind: 'claude', name: id, color: null, cwd: 'C:\\x', createdAt: 1, ...extra };
}
function project(name: string, sessions: SessionRecord[]): ProjectRecord {
  return { id: `p-${name}`, name, path: `C:\\${name}`, color: null, collapsed: false, sessions };
}
const rt = (m: Record<string, SessionStatus>): RuntimeMap => Object.fromEntries(Object.entries(m).map(([k, status]) => [k, { status }]));

describe('resumen del día', () => {
  it('agrupa por proyecto, con estado, hora, marca y nota, solo lo de hoy', () => {
    const projects = [
      project('Tienda', [
        session('s1', { name: 'Login', mark: '✅', lastActiveAt: at(11, 30), note: 'Falta probar con Google' }),
        session('s2', { name: 'Pagos', lastActiveAt: at(13, 0) }),
        session('s3', { name: 'Ayer', lastActiveAt: at(23, 59, -1) }),
        session('s4', { name: 'Sin actividad' }),
      ]),
      project('Blog', [session('s5', { name: 'Borrador', lastActiveAt: at(9, 15), mark: '🔥' })]),
      project('Vacío', [session('s6', { name: 'Vieja', lastActiveAt: at(10, 0, -3) })]),
    ];
    const out = buildDailySummary({ projects }, rt({ s1: 'done', s2: 'waiting', s5: 'error' }), NOW);
    expect(out).toBe(
      [
        '# Resumen del día — lunes 23 de noviembre de 2026',
        '',
        '3 sesiones con actividad hoy, en 2 proyectos. Hecho a las 14:05.',
        '',
        'Te espera: 1 · Falló: 1 · Terminó: 1',
        '',
        '## Tienda',
        '',
        '- ✅ **Login** — Terminó · 11:30',
        '  > **Nota:** Falta probar con Google',
        '- **Pagos** — Te espera · 13:00',
        '',
        '## Blog',
        '',
        '- 🔥 **Borrador** — Falló · 09:15',
        '',
      ].join('\n'),
    );
    expect(out).not.toContain('Ayer');
    expect(out).not.toContain('Vieja');
    expect(out).not.toContain('Vacío');
    expect(out).not.toContain('C:\\');
  });

  it('ordena las sesiones de un proyecto por hora, y usa dormida si no hay estado', () => {
    const projects = [project('P', [session('b', { name: 'Tarde', lastActiveAt: at(13) }), session('a', { name: 'Temprano', lastActiveAt: at(8) })])];
    const out = buildDailySummary({ projects }, {}, NOW);
    expect(out.indexOf('Temprano')).toBeLessThan(out.indexOf('Tarde'));
    expect(out).toContain('Dormida · 08:00');
    expect(out).toContain('Dormida: 2');
  });

  it('marca las PowerShell y dice los estados en reposo, trabajando y cerrada', () => {
    const projects = [
      project('P', [
        session('a', { kind: 'shell', name: 'PS', lastActiveAt: at(8) }),
        session('b', { name: 'Idle', lastActiveAt: at(9) }),
        session('c', { name: 'Work', lastActiveAt: at(10) }),
        session('d', { name: 'Gone', lastActiveAt: at(11) }),
      ]),
    ];
    const out = buildDailySummary({ projects }, rt({ a: 'idle', b: 'idle', c: 'working', d: 'exited' }), NOW);
    expect(out).toContain('- **PS** — PowerShell · En reposo · 08:00');
    expect(out).toContain('- **Work** — Trabajando · 10:00');
    expect(out).toContain('- **Gone** — Cerrada · 11:00');
    expect(out).toContain('4 sesiones con actividad hoy, en 1 proyecto.');
  });

  it('sin actividad hoy lo dice', () => {
    const projects = [project('P', [session('a', { lastActiveAt: at(10, 0, -1) }), session('b')])];
    expect(buildDailySummary({ projects }, {}, NOW)).toBe('# Resumen del día — lunes 23 de noviembre de 2026\n\nHoy no hubo actividad en ninguna sesión de Hilo.\n');
    expect(buildDailySummary({ projects: [] }, {}, NOW)).toContain('Hoy no hubo actividad');
  });

  it('las 00:00 locales son el límite', () => {
    const projects = [project('P', [session('a', { name: 'Justo', lastActiveAt: at(0, 0) }), session('b', { name: 'Antes', lastActiveAt: at(0, 0) - 1 })])];
    const out = buildDailySummary({ projects }, {}, NOW);
    expect(out).toContain('Justo');
    expect(out).not.toContain('Antes');
  });

  describe('zona horaria', () => {
    const original = Intl.DateTimeFormat().resolvedOptions().timeZone;
    afterEach(() => {
      process.env.TZ = original;
    });

    it('el mismo instante es hoy en una zona y ayer en otra', () => {
      // 2026-11-23 03:00 UTC: en Santiago (UTC-3 en verano) es el 23 a las 00:00; en Los Ángeles (UTC-8), el 22 a las 19:00.
      const instant = Date.UTC(2026, 10, 23, 3, 0);
      const projects = [project('P', [session('a', { name: 'Madrugada', lastActiveAt: instant })])];
      const nowUtc = Date.UTC(2026, 10, 23, 15, 0);

      process.env.TZ = 'America/Santiago';
      const santiago = buildDailySummary({ projects }, {}, new Date(nowUtc));
      expect(santiago).toContain('Madrugada');
      expect(santiago).toContain('lunes 23 de noviembre de 2026');
      expect(santiago).toContain('00:00');

      process.env.TZ = 'America/Los_Angeles';
      const angeles = buildDailySummary({ projects }, {}, new Date(nowUtc));
      expect(angeles).not.toContain('Madrugada');
      expect(angeles).toContain('Hoy no hubo actividad');
      expect(localDateStamp(new Date(nowUtc))).toBe('2026-11-23');
      expect(startOfLocalDay(new Date(nowUtc))).toBe(Date.UTC(2026, 10, 23, 8, 0));
    });
  });

  describe('texto del usuario', () => {
    const one = (extra: Partial<SessionRecord>) => buildDailySummary({ projects: [project('P', [session('a', { lastActiveAt: at(10), ...extra })])] }, {}, NOW);

    it('una nota con saltos de línea sigue dentro de su sesión, como cita', () => {
      const out = one({ note: 'primera\r\nsegunda\n\n\n\ntercera\r\n  \n' });
      expect(out).toContain('  > **Nota:** primera\n  > segunda\n  >\n  > tercera\n');
      // Nada de lo que escribió puede cerrar la lista ni empezar un bloque fuera de la cita.
      for (const line of out.split('\n').slice(8)) expect(line === '' || line.startsWith('- ') || line.startsWith('  >')).toBe(true);
    });

    it('escapa lo que Markdown interpreta', () => {
      const out = one({ note: '# Título\n- item\n1. uno\n```\ncódigo\n```\n> cita\n| a | b |\n**negrita** _cursiva_ [enlace](http://x) <b>html</b> snake_case ~~tachado~~\n---\n===' });
      const lines = out.split('\n').filter((l) => l.startsWith('  >'));
      expect(lines).toContain('  > **Nota:** \\# Título');
      expect(lines).toContain('  > \\- item');
      expect(lines).toContain('  > 1\\. uno');
      expect(lines).toContain('  > \\`\\`\\`');
      expect(lines).toContain('  > \\> cita');
      expect(lines).toContain('  > \\| a \\| b \\|');
      expect(lines).toContain('  > \\*\\*negrita\\*\\* \\_cursiva\\_ \\[enlace\\](http://x) \\<b\\>html\\</b\\> snake_case \\~\\~tachado\\~\\~');
      expect(lines).toContain('  > \\---');
      expect(lines).toContain('  > \\===');
    });

    it('el nombre, la marca y el proyecto no pueden abrir bloques ni romper la línea', () => {
      const projects = [project('## Hola\n# *x*', [session('a', { name: '**Malo**\n- otra\n# título `x`', mark: '*', lastActiveAt: at(10) })])];
      const out = buildDailySummary({ projects }, {}, NOW);
      expect(out).toContain('\n## ## Hola # \\*x\\*\n');
      expect(out).toContain('- \\* **\\*\\*Malo\\*\\* - otra # título \\`x\\`** — Dormida · 10:00\n');
    });

    it('quita caracteres de control y de dirección de lectura', () => {
      const out = one({ name: 'a\u0007b\u202ec', note: 'x\u0000y\u2067z' });
      expect(out).toContain('**abc**');
      expect(out).toContain('**Nota:** xyz');
    });

    it('una nota solo de espacios no deja nada', () => {
      expect(one({ note: '  \n \r\n' })).not.toContain('Nota');
    });
  });
});

describe('guardar el resumen', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hilo-resumen-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('el nombre lleva la fecha local y un número si hay otro', () => {
    expect(summaryFileName(NOW)).toBe('2026-11-23-resumen-hilo.md');
    expect(summaryFileName(NOW, 2)).toBe('2026-11-23-resumen-hilo-2.md');
  });

  it('escribe el archivo, no sobrescribe uno que ya está y no deja temporales', async () => {
    writeFileSync(join(dir, '2026-11-23-resumen-hilo.md'), 'mío');
    const first = await saveSummaryFile(dir, 'uno ñ\n', NOW);
    expect(first).toEqual({ ok: true, path: join(dir, '2026-11-23-resumen-hilo-2.md') });
    const second = await saveSummaryFile(dir, 'dos\n', NOW);
    expect(second).toEqual({ ok: true, path: join(dir, '2026-11-23-resumen-hilo-3.md') });
    expect(readFileSync(join(dir, '2026-11-23-resumen-hilo.md'), 'utf8')).toBe('mío');
    expect(readFileSync(join(dir, '2026-11-23-resumen-hilo-2.md'), 'utf8')).toBe('uno ñ\n');
    expect(readdirSync(dir).sort()).toEqual(['2026-11-23-resumen-hilo-2.md', '2026-11-23-resumen-hilo-3.md', '2026-11-23-resumen-hilo.md']);
  });

  it('rechaza carpetas que no existen, rutas relativas y archivos', async () => {
    expect((await saveSummaryFile(join(dir, 'no-esta'), 'x', NOW)).ok).toBe(false);
    expect((await saveSummaryFile('relativa', 'x', NOW)).ok).toBe(false);
    writeFileSync(join(dir, 'f'), '');
    expect((await saveSummaryFile(join(dir, 'f'), 'x', NOW)).ok).toBe(false);
    mkdirSync(join(dir, 'sub'));
    expect((await saveSummaryFile(join(dir, 'sub'), 'x', NOW)).ok).toBe(true);
  });

  it('solo acepta texto razonable', () => {
    expect(isSummaryText('hola')).toBe(true);
    expect(isSummaryText('')).toBe(false);
    expect(isSummaryText(5)).toBe(false);
    expect(isSummaryText('a\0b')).toBe(false);
    expect(isSummaryText('x'.repeat(MAX_SUMMARY_CHARS + 1))).toBe(false);
  });
});
