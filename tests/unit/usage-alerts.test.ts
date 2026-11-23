import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CustomSound } from '../../src/main/customSound';
import { UsageAlerter } from '../../src/main/usageAlerter';
import { DEFAULT_SETTINGS } from '../../src/shared/defaults';
import { CUSTOM_SOUND_MAX_BYTES } from '../../src/shared/sounds';
import { dueUsageAlerts, pruneFired, type UsageAlert } from '../../src/shared/usageAlerts';
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

describe('avisos de uso: umbrales que se activan después (#8)', () => {
  const now = 1_800_000_000_000;
  const usage = { at: now, session: { used: 85, resetsAt: now + 3_600_000, changed: now } };
  it('activar un umbral menor que uno ya avisado no avisa; uno mayor, sí', () => {
    const only80 = { usageAlerts: true, usageAlertSession: [80], usageAlertWeek: [] };
    const fired = new Set(dueUsageAlerts(usage, only80, new Set(), now).flatMap((a) => a.keys));
    expect(dueUsageAlerts(usage, { ...only80, usageAlertSession: [50, 80] }, fired, now)).toEqual([]);
    const higher = { at: now, session: { ...usage.session, used: 91 } };
    expect(dueUsageAlerts(higher, { ...only80, usageAlertSession: [50, 80, 90] }, fired, now).map((a) => a.threshold)).toEqual([90]);
  });
});

describe('lo que guarda el proceso principal (#8, #12)', () => {
  const root = mkdtempSync(join(tmpdir(), 'hilo-avisos-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const now = Date.now();
  const usage = { at: now, session: { used: 86, resetsAt: now + 3_600_000, changed: now } };
  const settings = () => ({ ...DEFAULT_SETTINGS, usageAlerts: true, usageAlertSession: [80], usageAlertWeek: [] });

  it('UsageAlerter avisa una vez, y otra instancia con la misma carpeta no repite', () => {
    const dir = mkdtempSync(join(root, 'uso-'));
    const got: UsageAlert[] = [];
    const first = new UsageAlerter(dir, settings, (a) => got.push(a));
    first.check(null);
    first.check(usage);
    first.check(usage);
    expect(got.map((a) => [a.window, a.threshold])).toEqual([['session', 80]]);
    const again: UsageAlert[] = [];
    new UsageAlerter(dir, settings, (a) => again.push(a)).check(usage);
    expect(again).toEqual([]);
    // Un archivo roto se ignora: en el peor caso se repite un aviso.
    writeFileSync(join(dir, 'avisos-uso.json'), '{roto');
    const broken: UsageAlert[] = [];
    new UsageAlerter(dir, settings, (a) => broken.push(a)).check(usage);
    expect(broken).toHaveLength(1);
  });

  it('CustomSound guarda una copia, reemplaza la anterior y rechaza lo que no sirve', () => {
    const data = mkdtempSync(join(root, 'datos-'));
    const src = mkdtempSync(join(root, 'origen-'));
    const wav = join(src, 'aviso.wav');
    const mp3 = join(src, 'otro.mp3');
    writeFileSync(wav, Buffer.from([1, 2, 3]));
    writeFileSync(mp3, Buffer.from([4, 5]));
    const sound = new CustomSound(data);
    expect(sound.read()).toBeNull();
    expect(sound.adopt(wav)).toEqual({ ok: true, name: 'aviso.wav' });
    expect([...sound.read()!]).toEqual([1, 2, 3]);
    expect(sound.adopt(mp3)).toEqual({ ok: true, name: 'otro.mp3' });
    expect(readdirSync(join(data, 'sonidos'))).toEqual(['propio.mp3']);
    expect([...sound.read()!]).toEqual([4, 5]);

    const txt = join(src, 'nota.txt');
    const empty = join(src, 'vacio.ogg');
    const big = join(src, 'grande.wav');
    writeFileSync(txt, 'hola');
    writeFileSync(empty, '');
    writeFileSync(big, Buffer.alloc(CUSTOM_SOUND_MAX_BYTES + 1));
    for (const bad of [txt, empty, big, join(src, 'no-existe.wav')]) {
      expect(sound.adopt(bad).ok, bad).toBe(false);
    }
    // Lo que falla no toca el audio que ya había.
    expect([...sound.read()!]).toEqual([4, 5]);
    sound.clear();
    expect(sound.read()).toBeNull();
  });
});
