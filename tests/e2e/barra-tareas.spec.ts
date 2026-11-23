import { expect, test, type ElectronApplication } from '@playwright/test';
import { cleanup, launch, makeState, settle } from './helpers';

type Overlay = { label: string; description: string } | null;
const calls = (app: ElectronApplication) =>
  app.evaluate(() => {
    const c = (globalThis as any).__hilo.taskbarCalls as { overlays: Overlay[]; flashes: boolean[] };
    return { overlays: [...c.overlays], flashes: [...c.flashes] };
  });
const lastOverlay = async (app: ElectronApplication) => (await calls(app)).overlays.at(-1);
const flashedOn = async (app: ElectronApplication) => (await calls(app)).flashes.filter(Boolean).length;
const setFocus = (app: ElectronApplication, focused: boolean) => app.evaluate((_e, f) => (globalThis as any).__hilo.focus(f), focused);

/** Lleva la sesión a un estado sin Claude: una máquina "idle" y el evento que Claude mandaría. */
const drive = (app: ElectronApplication, id: string, ev: object) =>
  app.evaluate(
    (_e, a) => {
      const s = (globalThis as any).__hilo.sessions;
      if (!s.machines.has(a.id) || s.machines.get(a.id).status === 'asleep') s.machines.set(a.id, { kind: 'claude', status: 'idle', stopLatchUntil: 0 });
      s.apply(a.id, a.ev);
    },
    { id, ev },
  );
const waiting = (app: ElectronApplication, id: string) => drive(app, id, { t: 'hook', name: 'PermissionRequest' });
const resumed = (app: ElectronApplication, id: string) => drive(app, id, { t: 'sessionFile', status: 'idle' });

test('la barra de tareas cuenta las sesiones que esperan y parpadea solo sin foco', async () => {
  const ctx = await launch({ state: makeState([{ id: 'a', name: 'Uno' }, { id: 'b', name: 'Dos' }, { id: 'c', name: 'Tres' }]) });
  try {
    const { app } = ctx;
    expect(await calls(app)).toEqual({ overlays: [], flashes: [] });

    // Sin foco: una sesión te espera. Cuenta 1 y parpadea.
    await setFocus(app, false);
    await settle(400);
    await waiting(app, 'a');
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '1', description: '1 sesión necesita tu atención' });
    await expect.poll(() => flashedOn(app)).toBe(1);

    // Otra más: la cuenta sube.
    await waiting(app, 'b');
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '2', description: '2 sesiones necesitan tu atención' });
    await expect.poll(() => flashedOn(app)).toBe(2);

    // Al volver a Hilo se apaga el parpadeo; el contador sigue mientras te esperen.
    await setFocus(app, true);
    await expect.poll(async () => (await calls(app)).flashes.at(-1)).toBe(false);
    expect(await lastOverlay(app)).toMatchObject({ label: '2' });

    // Con foco, una tercera cuenta pero no parpadea.
    const before = await flashedOn(app);
    await waiting(app, 'c');
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '3', description: '3 sesiones necesitan tu atención' });
    await settle(400);
    expect(await flashedOn(app)).toBe(before);

    // Cuando dejan de esperar, la cuenta baja y al final el círculo se quita.
    await resumed(app, 'a');
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '2', description: '2 sesiones necesitan tu atención' });
    await resumed(app, 'b');
    await resumed(app, 'c');
    await expect.poll(() => lastOverlay(app)).toBeNull();

    // Una sesión que falla, sin foco: parpadea y también entra en la cuenta.
    await setFocus(app, false);
    await settle(400);
    const beforeError = await flashedOn(app);
    await drive(app, 'a', { t: 'exit', code: 1, requested: false });
    await expect.poll(() => flashedOn(app)).toBe(beforeError + 1);
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '1', description: '1 sesión necesita tu atención' });
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test('con las notificaciones apagadas no parpadea, pero el contador sigue', async () => {
  const state = makeState([{ id: 'a', name: 'Uno' }]);
  state.settings.notifications = false;
  const ctx = await launch({ state });
  try {
    const { app } = ctx;
    await setFocus(app, false);
    await settle(400);
    await waiting(app, 'a');
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '1', description: '1 sesión necesita tu atención' });
    await settle(400);
    expect(await flashedOn(app)).toBe(0);
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

const started = (app: ElectronApplication, id: string) => drive(app, id, { t: 'hook', name: 'UserPromptSubmit' });
const finished = (app: ElectronApplication, id: string) => drive(app, id, { t: 'hook', name: 'Stop' });
const seen = (app: ElectronApplication, id: string) => drive(app, id, { t: 'viewed' });

test('también cuentan las que terminaron sin verse y las que fallaron, y dejan de contar al verlas', async () => {
  const ctx = await launch({ state: makeState([{ id: 'a', name: 'Uno' }, { id: 'b', name: 'Dos' }, { id: 'c', name: 'Tres' }]) });
  try {
    const { app } = ctx;
    // Sin foco, así que terminar no se marca como visto por sí solo.
    await setFocus(app, false);
    await settle(400);

    // Una terminó sin que la vieras: cuenta, pero no parpadea (solo parpadea lo que espera o falla).
    await started(app, 'a');
    await finished(app, 'a');
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '1', description: '1 sesión necesita tu atención' });
    await settle(400);
    expect(await flashedOn(app)).toBe(0);

    // Otra falla: suma y parpadea. Otra te espera: suma y parpadea.
    await drive(app, 'b', { t: 'exit', code: 1, requested: false });
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '2', description: '2 sesiones necesitan tu atención' });
    await waiting(app, 'c');
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '3', description: '3 sesiones necesitan tu atención' });
    await expect.poll(() => flashedOn(app)).toBe(2);

    // Verla quita el verde y deja de contar; responderle a la que esperaba también.
    await seen(app, 'a');
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '2', description: '2 sesiones necesitan tu atención' });
    await resumed(app, 'c');
    await expect.poll(() => lastOverlay(app)).toEqual({ label: '1', description: '1 sesión necesita tu atención' });
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
