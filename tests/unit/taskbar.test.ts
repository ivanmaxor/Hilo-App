import { describe, expect, it } from 'vitest';
import { BADGE_SIZE, badgeDescription, badgeLabel, renderBadge, attentionCount } from '../../src/shared/taskbar';
import type { SessionStatus } from '../../src/shared/types';

describe('aviso en la barra de tareas', () => {
  it('cuenta las que esperan, las que terminaron sin verse y las que fallaron', () => {
    const all: SessionStatus[] = ['asleep', 'starting', 'working', 'idle', 'done', 'error', 'exited', 'waiting', 'waiting'];
    expect(attentionCount(all)).toBe(4);
    expect(attentionCount([])).toBe(0);
    expect(attentionCount(['done', 'error', 'waiting'])).toBe(3);
    expect(attentionCount(['working', 'idle', 'asleep', 'starting', 'exited'])).toBe(0);
  });

  it('el texto del círculo llega a 9 y luego es «9+»', () => {
    expect(badgeLabel(0)).toBe('');
    expect(badgeLabel(-3)).toBe('');
    expect(badgeLabel(NaN)).toBe('');
    expect(badgeLabel(1)).toBe('1');
    expect(badgeLabel(9)).toBe('9');
    expect(badgeLabel(10)).toBe('9+');
    expect(badgeLabel(250)).toBe('9+');
  });

  it('la descripción dice la cantidad real, aunque el círculo diga 9+', () => {
    expect(badgeDescription(0)).toBe('');
    expect(badgeDescription(1)).toBe('1 sesión necesita tu atención');
    expect(badgeDescription(2)).toBe('2 sesiones necesitan tu atención');
    expect(badgeDescription(12)).toBe('12 sesiones necesitan tu atención');
  });

  it('dibuja un círculo con texto, distinto para cada número', () => {
    expect(renderBadge('')).toBeNull();
    expect(renderBadge('x')).toBeNull();
    const seen = new Set<string>();
    for (const label of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']) {
      const px = renderBadge(label)!;
      expect(px.length).toBe(BADGE_SIZE * BADGE_SIZE * 4);
      const at = (x: number, y: number) => px[(y * BADGE_SIZE + x) * 4 + 3];
      // Opaco en el centro y transparente en las esquinas.
      expect(px.some((v, i) => i % 4 === 3 && v === 255)).toBe(true);
      expect(at(0, 0)).toBe(0);
      expect(at(BADGE_SIZE - 1, BADGE_SIZE - 1)).toBe(0);
      seen.add(Buffer.from(px).toString('base64'));
    }
    expect(seen.size).toBe(10);
  });
});
