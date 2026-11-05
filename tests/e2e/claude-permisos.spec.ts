import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { CLAUDE_ARGS, send, TRUSTED, uuid } from './claude-helpers';
import { bufferText, cleanup, launch, makeState, newDataDir, settle, status, waitStatus } from './helpers';

function commandLineOf(pid: number): string {
  return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8' }).trim();
}

/**
 * Lo que pidió el dueño: dormir guarda el id, y despertar hace
 * `claude --resume <id> --dangerously-skip-permissions`, retomando la conversación.
 * El segundo --settings evita la advertencia sin que la prueba tenga que aceptarla: eso se guardaría en la
 * configuración global del dueño.
 */
test.describe('Claude real con el flag de permisos', () => {
  test.skip(process.env.HILO_E2E_CLAUDE !== '1', 'Definir HILO_E2E_CLAUDE=1 para usar Claude real');
  test.setTimeout(180_000);

  test('dormir y despertar retoma con --resume y --dangerously-skip-permissions', async () => {
    const dataDir = newDataDir();
    const id = uuid();
    const state = makeState([{ id, kind: 'claude', name: 'Con flag' }], TRUSTED);
    state.settings.skipPermissions = true;
    const { app, page, close } = await launch({ dataDir, state, claudeArgs: [...CLAUDE_ARGS, '--settings', '{"skipDangerousModePermissionPrompt":true}'] });
    const pidOf = () => app.evaluate((_e, sid) => (globalThis as any).__hilo.pidOf(sid) as number, id);
    try {
      await page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
      await waitStatus(page, id, 'idle', 60_000);
      const first = commandLineOf(await pidOf());
      expect(first).toContain('--dangerously-skip-permissions');
      expect(first).toContain(`--session-id ${id}`);

      await send(page, id, 'Responde solo: PALABRA-PERMISOS');
      await waitStatus(page, id, 'done', 60_000);

      await page.evaluate((sid) => (window as any).__hiloTest.sleepSession(sid), id);
      await waitStatus(page, id, 'asleep', 30_000);

      await page.evaluate((sid) => (window as any).__hiloTest.wakeSession(sid), id);
      await waitStatus(page, id, 'idle', 60_000);
      const second = commandLineOf(await pidOf());
      console.log(`[permisos] ${second.replace(/--settings \S+/, '--settings …')}`);
      expect(second).toContain(`--resume ${id}`);
      expect(second).toContain('--dangerously-skip-permissions');
      await settle(1500);
      expect(await bufferText(page, id)).toContain('PALABRA-PERMISOS');
      expect(await status(page, id)).toBe('idle');
    } finally {
      await close();
      cleanup(dataDir);
    }
  });
});
