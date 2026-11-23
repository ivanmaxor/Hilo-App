import { describe, expect, it } from 'vitest';
import { dueUsageAlerts, pruneFired } from '../../src/shared/usageAlerts';
import { sanitizeSettings } from '../../src/shared/validate';
describe('avisos de uso del plan (#8)', () => {
  const now = 1_800_000_000_000;
  const settings = { usageAlerts: true, usageAlertSession: [80, 95], usageAlertWeek: [80] };
  const usage = (session: number, week: number) => ({
    at: now,
    session: { used: session, resetsAt: now + 3_600_000, changed: now },
    week: { used: week, resetsAt: now + 5 * 86_400_000, changed: now },
  });
  it('avisa el umbral más alto cruzado, una sola vez por ventana', () => {
    expect(dueUsageAlerts(usage(70, 10), settings, new Set(), now)).toEqual([]);
    const first = dueUsageAlerts(usage(96, 10), settings, new Set(), now);
    expect(first.map((a) => [a.window, a.threshold])).toEqual([['session', 95]]);
    const fired = new Set(first.flatMap((a) => a.keys));
    expect(dueUsageAlerts(usage(97, 10), settings, fired, now)).toEqual([]);
    expect(dueUsageAlerts(usage(97, 81), settings, fired, now).map((a) => a.window)).toEqual(['week']);
    expect(dueUsageAlerts(usage(99, 99), { ...settings, usageAlerts: false }, new Set(), now)).toEqual([]);
  });
  it('una ventana renovada vuelve a avisar, y lo viejo se olvida', () => {
    const fired = new Set(dueUsageAlerts(usage(85, 0), settings, new Set(), now).flatMap((a) => a.keys));
    const later = now + 2 * 3_600_000;
    const next = { at: later, session: { used: 85, resetsAt: later + 3_600_000, changed: later } };
    expect(dueUsageAlerts(next, settings, fired, later).map((a) => a.threshold)).toEqual([80]);
    expect(pruneFired(fired, later)).toEqual([]);
    expect(sanitizeSettings({ usageAlertSession: [95, 80, 80, 33, '90'] }).usageAlertSession).toEqual([80, 95]);
    expect(sanitizeSettings({ soundDone: 'propio', customSoundName: 'a/b.mp3' })).toMatchObject({ soundDone: 'propio', customSoundName: '' });
  });
});
