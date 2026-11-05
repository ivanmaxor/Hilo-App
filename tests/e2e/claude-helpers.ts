import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { bufferText, focusTerm, ROOT, settle } from './helpers';

/**
 * Pruebas con Claude Code real: `--model haiku` y prompts mínimos.
 * Sin los hooks globales del usuario (`--setting-sources project,local`) para no
 * reproducir sus sonidos, y sin MCP para gastar menos. Los hooks de Hilo siguen activos.
 */
export const CLAUDE_ARGS = ['--model', 'haiku', '--effort', 'low', '--strict-mcp-config', '--setting-sources', 'project,local'];

// Carpeta ya marcada como confiable por las grabaciones de R2; si no existe se usa otra.
export const TRUSTED = process.env.HILO_E2E_CWD ?? join(ROOT, '.test-data', 'claude-cwd');
if (!existsSync(TRUSTED)) mkdirSync(TRUSTED, { recursive: true });

export function uuid(): string {
  return crypto.randomUUID();
}

export async function acceptTrustIfNeeded(page: Page, id: string): Promise<void> {
  await settle(2500);
  const text = await bufferText(page, id);
  if (text.includes('trust this folder')) {
    await focusTerm(page, id);
    await page.keyboard.press('ArrowDown');
    await settle(800);
    await page.keyboard.press('Enter');
    await settle(1500);
  }
}

export async function send(page: Page, id: string, prompt: string): Promise<void> {
  await focusTerm(page, id);
  await page.keyboard.type(prompt, { delay: 1 });
  await settle(200);
  await page.keyboard.press('Enter');
}
