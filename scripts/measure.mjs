// Mide la RAM de la app empaquetada con 9 sesiones (Claude real con haiku, o PowerShell).
// node scripts/measure.mjs <Hilo.exe> <carpeta confiable> [corridas] [--shells]
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { freemem, tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [exe, cwd, runsArg, mode] = process.argv.slice(2);
const runs = Number(runsArg ?? 3);
const shells = mode === '--shells';
const medir = join(root, 'docs', 'investigacion', 'tools', 'medir-ram.ps1');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_FREE_MB = 3000;
// Lo bastante largo para seguir trabajando durante todas las muestras.
const LONG_PROMPT = 'Escribe los numeros del 1 al 1500, uno por linea, sin nada mas.';

function measure(pid, label, samples = 6) {
  const json = join(tmpdir(), `hilo-ram-${Date.now()}.json`);
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', medir, '-RootPid', String(pid), '-Samples', String(samples), '-IntervalSec', '3', '-Quiet', '-Json', json], { stdio: 'ignore' });
  const data = JSON.parse(readFileSync(json, 'utf8').replace(/^﻿/, ''));
  rmSync(json, { force: true });
  const procs = data.processes ?? [];
  const sum = (list, field) => Math.round(list.reduce((a, p) => a + Number(p[field] ?? 0), 0) * 10) / 10;
  const group = (re) => procs.filter((p) => re.test(p.Name));
  const app = group(/^(Hilo|electron)\.exe$/i);
  const consolas = group(/^OpenConsole\.exe$/i);
  const resto = procs.filter((p) => !/^(Hilo|electron|OpenConsole|conhost)\.exe$/i.test(p.Name));
  const net = {
    procesos: app.length,
    PrivWS: sum(app, 'PrivWS MB'),
    WS: sum(app, 'WS MB'),
    PrivBytes: sum(app, 'PrivBytes MB'),
    consolas: sum(consolas, 'PrivWS MB'),
    sesionesPrivWS: sum(resto, 'PrivWS MB'),
  };
  return { label, net };
}

async function run(n) {
  if (freemem() / 1048576 < MIN_FREE_MB) throw new Error(`Menos de ${MIN_FREE_MB} MB libres: 9 sesiones pueden dejar la máquina sin memoria.`);
  const dataDir = mkdtempSync(join(tmpdir(), 'hilo-ram-'));
  const ids = Array.from({ length: 9 }, () => crypto.randomUUID());
  const state = {
    version: 1,
    projects: [
      {
        id: 'p',
        name: 'medir',
        path: cwd,
        color: null,
        collapsed: false,
        sessions: ids.map((id, i) => ({ id, claudeId: id, kind: shells ? 'shell' : 'claude', name: `S${i + 1}`, color: null, cwd, createdAt: 1, model: 'haiku', effort: 'low' })),
      },
    ],
    // Sin el flag: con --setting-sources project,local saldría la advertencia de Claude y no arrancaría.
    settings: { startup: 'wakeAll', skipPermissions: false },
    ui: { activeSessionId: ids[0], panes: [ids[0]], layout: 1, activePane: 0 },
    window: { width: 1280, height: 800, maximized: false },
  };
  writeFileSync(join(dataDir, 'state.json'), JSON.stringify(state));
  const port = 9400 + n;
  const env = {
    ...process.env,
    HILO_E2E: '1',
    HILO_DATA_DIR: dataDir,
    HILO_TEST_HIDDEN: '1',
    HILO_TEST_CLIPBOARD: 'memory',
    HILO_TEST_CLAUDE_ARGS: JSON.stringify(['--strict-mcp-config', '--setting-sources', 'project,local']),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 60 && !browser; i++) {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      } catch {
        await sleep(500);
      }
    }
    if (!browser) throw new Error('No se pudo conectar con la app');
    let page;
    for (let i = 0; i < 60 && !page; i++) {
      page = browser.contexts()[0]?.pages()[0];
      if (!page) await sleep(500);
    }
    if (!page) throw new Error('La app no abrió su ventana');
    await page.waitForFunction(() => !!window.__hiloTest);
    await sleep(9 * 500 + 8000);
    const statuses = () => page.evaluate((list) => list.map((id) => window.__hiloTest.app.get().runtime[id]?.status), ids);
    console.log(`corrida ${n}: estados`, (await statuses()).join(','));
    await sleep(20000);
    const idle = measure(child.pid, 'reposo');
    console.log(`corrida ${n} reposo:`, idle.net);

    let working = null;
    if (!shells) {
      for (const id of ids.slice(0, 2)) {
        await page.evaluate((sid) => window.__hiloTest.selectSession(sid), id);
        await page.waitForTimeout(300);
        await page.keyboard.type(LONG_PROMPT, { delay: 1 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(300);
      }
      await sleep(1500);
      const during = (await statuses()).filter((s) => s === 'working').length;
      working = measure(child.pid, 'trabajando', 4);
      const after = (await statuses()).filter((s) => s === 'working').length;
      console.log(`corrida ${n} 2 trabajando (trabajando al empezar ${during}, al acabar ${after}):`, working.net);
    }
    return { idle, working };
  } finally {
    await browser?.close().catch(() => undefined);
    child.kill();
    await sleep(6000);
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

const results = [];
for (let n = 1; n <= runs; n++) results.push(await run(n));
const pick = (r, key, field) => r[key]?.net?.[field];
const median = (arr) => {
  const s = arr.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
for (const key of ['idle', 'working']) {
  for (const field of ['PrivWS', 'WS', 'PrivBytes', 'consolas', 'sesionesPrivWS']) {
    console.log(`Mediana ${key} ${field}:`, median(results.map((r) => pick(r, key, field))));
  }
}
