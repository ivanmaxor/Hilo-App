import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { acceptTrustIfNeeded, CLAUDE_ARGS, send, TRUSTED, uuid } from './claude-helpers';
import { cleanup, launch, makeState, newDataDir, waitStatus } from './helpers';

/**
 * #6: Claude retoma con `--resume <id>` desde otra carpeta. Si una versión futura de Claude Code cambia
 * esto, esta prueba avisa. Con Claude real y haiku: consume poco. Solo borra lo que ella misma creó.
 */
test.describe('Claude real: retomar desde otra carpeta', () => {
  test.skip(process.env.HILO_E2E_CLAUDE !== '1', 'Definir HILO_E2E_CLAUDE=1');
  test.setTimeout(300_000);

  const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const slug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');
  const transcript = (cwd: string, id: string) => join(configDir, 'projects', slug(cwd), `${id}.jsonl`);

  test('la sesión pasa a otra carpeta y retoma la misma conversación, sin crear una nueva', async () => {
    const id = uuid();
    const otra = join(TRUSTED, 'otra-carpeta');
    mkdirSync(otra, { recursive: true });
    const dataDir = newDataDir();
    let ctx = await launch({ dataDir, state: makeState([{ id, kind: 'claude', name: 'Retomar' }], TRUSTED), claudeArgs: CLAUDE_ARGS });
    try {
      // 1. La conversación nace en la carpeta de siempre.
      await ctx.page.evaluate((x) => (window as any).__hiloTest.selectSession(x), id);
      await acceptTrustIfNeeded(ctx.page, id);
      await waitStatus(ctx.page, id, 'idle', 60_000);
      await send(ctx.page, id, 'responde solo OK');
      await waitStatus(ctx.page, id, 'working', 30_000);
      await waitStatus(ctx.page, id, ['done', 'idle'], 90_000);
      expect(existsSync(transcript(TRUSTED, id))).toBe(true);
      const antes = statSync(transcript(TRUSTED, id)).size;

      // 2. Se duerme, y la sesión pasa a otra carpeta (como cuando el proyecto se mueve).
      await ctx.page.evaluate((x) => (window as any).__hiloTest.sleepSession(x), id);
      await waitStatus(ctx.page, id, 'asleep', 30_000);
      await ctx.close();
      const file = join(dataDir, 'state.json');
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      saved.projects[0].sessions[0].cwd = otra;
      writeFileSync(file, JSON.stringify(saved));

      // 3. Al despertarla retoma la misma conversación: no se cambia el id ni nace una vacía en la carpeta nueva.
      ctx = await launch({ dataDir, claudeArgs: CLAUDE_ARGS });
      await ctx.page.evaluate((x) => (window as any).__hiloTest.selectSession(x), id);
      await acceptTrustIfNeeded(ctx.page, id);
      await waitStatus(ctx.page, id, 'idle', 60_000);
      await send(ctx.page, id, 'responde solo OK de nuevo');
      await waitStatus(ctx.page, id, 'working', 30_000);
      await waitStatus(ctx.page, id, ['done', 'idle'], 90_000);

      const despues = JSON.parse(readFileSync(file, 'utf8')).projects[0].sessions[0];
      expect(despues.claudeId).toBe(id);
      expect(existsSync(transcript(otra, id)), 'no debe nacer una conversación nueva en la carpeta nueva').toBe(false);
      expect(statSync(transcript(TRUSTED, id)).size, 'la conversación original siguió creciendo').toBeGreaterThan(antes);
    } finally {
      await ctx.close();
      cleanup(dataDir);
      // Solo lo que esta prueba creó: la conversación por su id (y su carpeta de subagentes, si hay).
      for (const cwd of [TRUSTED, otra]) {
        rmSync(transcript(cwd, id), { force: true });
        rmSync(join(configDir, 'projects', slug(cwd), id), { recursive: true, force: true });
      }
    }
  });
});
