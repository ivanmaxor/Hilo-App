import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, launch, makeState, newDataDir, ROOT, status, waitStatus } from './helpers';

/**
 * #6: si el historial existe pero Claude no lo retoma, Hilo no cambia el id en silencio ni deja la sesión
 * atascada: el panel ofrece, a elección de la persona, empezar una conversación nueva. Con un `claude.cmd` falso
 * y una carpeta de configuración temporal: no toca ~/.claude ni usa Claude real.
 */
const claudeIdOf = (page: any, id: string) =>
  page.evaluate((sid: string) => (window as any).__hiloTest.app.get().state.projects[0].sessions.find((s: any) => s.id === sid).claudeId, id);

test('historial que existe pero no se retoma: avisa, no cambia el id solo, y deja empezar de nuevo', async () => {
  const id = crypto.randomUUID();
  const scratch = newDataDir();
  const config = join(scratch, 'claude-config');
  const transcript = join(config, 'projects', ROOT.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(join(transcript, '..'), { recursive: true });
  writeFileSync(transcript, '{"type":"user"}\n');
  // Un Claude falso: dice que no encuentra la conversación y sale con error, como `claude --resume <id>` real.
  const fake = join(scratch, 'claude.cmd');
  writeFileSync(fake, '@echo off\r\necho No conversation found with session ID: %~2\r\nexit /b 1\r\n');

  const state = makeState([{ id, kind: 'claude', name: 'Atascada' }]);
  state.settings.claudePath = fake;
  const dataDir = newDataDir();
  const run = await launch({ dataDir, state, env: { CLAUDE_CONFIG_DIR: config } });
  try {
    const { page } = run;
    await page.evaluate((x) => (window as any).__hiloTest.selectSession(x), id);
    await waitStatus(page, id, 'error', 30_000);

    // El panel lo dice, ofrece la salida, y el id sigue siendo el mismo (no se cambió en silencio).
    const fresh = page.locator(`[data-fresh-conversation="${id}"]`);
    await expect(fresh).toBeVisible();
    await expect(page.locator('.overlay')).toContainText('no se pudo retomar');
    expect(await claudeIdOf(page, id)).toBe(id);
    expect(existsSync(transcript)).toBe(true);

    // Una sesión sana no deja cambiar su carpeta con fixFolder.
    const guard = await page.evaluate((x) => (window as any).hilo.fixFolder(x, 'project'), id);
    expect(guard).toMatchObject({ ok: false });

    // La persona decide empezar de nuevo: se pide confirmación, y recién entonces cambia el id.
    await fresh.click();
    await expect(page.locator('.dialog h2')).toContainText('conversación nueva');
    expect(await claudeIdOf(page, id)).toBe(id);
    await page.locator('.dialog [data-confirm="ok"]').click();
    await expect.poll(() => claudeIdOf(page, id)).not.toBe(id);
    // El historial viejo no se toca: sigue donde Claude lo guardó.
    expect(existsSync(transcript)).toBe(true);
    expect(await status(page, id)).not.toBe('asleep');
  } finally {
    await run.close();
    cleanup(dataDir);
    cleanup(scratch);
  }
});
