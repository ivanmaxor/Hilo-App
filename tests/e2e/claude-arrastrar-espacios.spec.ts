import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from '@playwright/test';
import { dropReference } from '../../src/shared/dropPaths';
import { acceptTrustIfNeeded, CLAUDE_ARGS, send, TRUSTED, uuid } from './claude-helpers';
import { bufferText, cleanup, launch, makeState, newDataDir, waitStatus } from './helpers';
import { expect } from '@playwright/test';

// Con Claude real: lo que Hilo pega al arrastrar un archivo con espacios (#9) tiene que poder leerlo Claude Code.
test.skip(process.env.HILO_E2E_CLAUDE !== '1', 'Definir HILO_E2E_CLAUDE=1');
test.setTimeout(300_000);

test('Claude Code lee un archivo con espacios por @"ruta" y por la ruta completa entre comillas', async () => {
  const id = uuid();
  const cfg = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const dir = join(cfg, 'projects', TRUSTED.replace(/[^a-zA-Z0-9]/g, '-'));
  mkdirSync(TRUSTED, { recursive: true });
  const archivo = join(TRUSTED, 'mi archivo de prueba.txt');
  writeFileSync(archivo, 'La palabra secreta es ZORRO-9137.\n');
  const dataDir = newDataDir();
  const ctx = await launch({ dataDir, state: makeState([{ id, kind: 'claude', name: 'Arroba' }], TRUSTED), claudeArgs: CLAUDE_ARGS });
  try {
    const { page } = ctx;
    await page.evaluate((x) => (window as any).__hiloTest.selectSession(x), id);
    await acceptTrustIfNeeded(page, id);
    await waitStatus(page, id, 'idle', 60_000);

    const probar = async (referencia: string) => {
      await send(page, id, `Dime solo la palabra secreta que dice el archivo ${referencia}. Si no puedes leerlo, responde NO PUDE.`);
      await waitStatus(page, id, 'working', 30_000).catch(() => undefined);
      await waitStatus(page, id, ['done', 'idle'], 120_000);
      await page.waitForTimeout(1500);
      return bufferText(page, id);
    };
    // Dentro de la carpeta de la sesión: @"ruta relativa".
    const dentro = dropReference(archivo, TRUSTED);
    expect(dentro).toBe('@"mi archivo de prueba.txt"');
    expect(await probar(dentro)).toContain('ZORRO-9137');
    // Fuera de ella: la ruta completa entre comillas.
    const fuera = dropReference(archivo, null);
    expect(fuera).toBe(`"${archivo}"`);
    expect(await probar(fuera)).toContain('ZORRO-9137');
  } finally {
    await ctx.close();
    cleanup(dataDir);
    rmSync(archivo, { force: true });
    rmSync(join(dir, `${id}.jsonl`), { force: true });
    rmSync(join(dir, id), { recursive: true, force: true });
  }
});
