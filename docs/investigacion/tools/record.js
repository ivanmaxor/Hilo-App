#!/usr/bin/env node
// record.js - lanza un proceso en un pty propio (node-pty/ConPTY), graba la salida con timestamps
// en .jsonl y ejecuta un guion de pasos.
//
// Uso: node record.js <escenario.js|json> [nombre-salida]
//
// Escenario: {
//   name, file, args, cwd, env: {VAR: valor}, cols=120, rows=30,
//   backend: 'system' (conhost del SO, default de node-pty) | 'dll' (conpty.dll+OpenConsole.exe de node-pty),
//   answer: true  (xterm headless contesta queries del terminal, como haria un xterm.js real),
//   hardTimeoutMs: 180000, outDir,
//   watchSessionFile: true (registra cambios de ~/.claude/sessions/<pid>.json como {t,sessfile}),
//   steps: [
//     {wait: ms}, {until:'regex', timeout:ms}  (sobre pantalla renderizada),
//     {untilRaw:'regex', timeout:ms}           (sobre bytes crudos desde el ultimo write),
//     {write:'texto'}, {mark:'etiqueta'}, {snap:'etiqueta'} (vuelca la pantalla),
//     {procs:true}  (arbol de procesos descendientes, sin linea de comandos),
//     {kill:true},  {waitExit:ms},
//     {ifScreen:'regex', write:'texto'} (escribe solo si la pantalla coincide),
//   ]
// }
//
// Formato .jsonl (t = ms desde spawn):
//   {t,data}  chunk de salida del pty      {t,in}    bytes escritos al pty
//   {t,reply} respuesta del emulador       {t,mark}  marca del guion
//   {t,snap,screen} pantalla               {t,procs} arbol de procesos
//   {t,exit,signal} fin del proceso        {meta}    primera linea
//
// Nota: en Windows node-pty no admite encoding null; data es la cadena UTF-8 ya decodificada.
//
// El entorno hijo parte de process.env SIN variables que delaten terminal/sesion
// padre (CLAUDE*, ANTHROPIC*, WT_*, TERM_PROGRAM...). Solo se anaden las de `env`.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');

const scenarioPath = path.resolve(process.argv[2]);
const sc = require(scenarioPath);
const name = process.argv[3] || sc.name || path.basename(scenarioPath).replace(/\.\w+$/, '');
const outDir = sc.outDir || path.join(__dirname, 'rec');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, name + '.jsonl');
const out = fs.openSync(outFile, 'w');

const STRIP = /^(CLAUDE|ANTHROPIC|WT_|TERM_PROGRAM|COLORTERM|VSCODE|CURSOR_|ITERM|KITTY|TMUX|ZED_|WEZTERM|GHOSTTY|ALACRITTY|ConEmu|MCP_|VTE_)/i;
const env = {};
for (const [k, v] of Object.entries(process.env)) if (!STRIP.test(k)) env[k] = v;
env.TERM = 'xterm-256color';
Object.assign(env, sc.env || {});

const cols = sc.cols || 120, rows = sc.rows || 30;
const t0 = Date.now();
const now = () => Date.now() - t0;
let closed = false;
const rec = (o) => closed ? 0 : fs.writeSync(out, JSON.stringify({ t: now(), ...o }) + '\n');

const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true });
const screen = () => {
  const b = term.buffer.active, lines = [];
  for (let i = 0; i < b.length; i++) lines.push(b.getLine(i).translateToString(true));
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join('\n');
};

fs.writeSync(out, JSON.stringify({ meta: { name, file: path.basename(sc.file), args: sc.args || [], envAdded: Object.keys(sc.env || {}), backend: sc.backend || 'system', answer: sc.answer !== false, cols, rows, epoch: t0, date: new Date().toISOString() } }) + '\n');

const p = pty.spawn(sc.file, sc.args || [], {
  name: 'xterm-256color', cols, rows, cwd: sc.cwd || process.cwd(), env,
  useConpty: true, useConptyDll: sc.backend === 'dll',
});
fs.appendFileSync(path.join(__dirname, 'pids.log'), `${new Date().toISOString()} ${name} pid=${p.pid}\n`);
rec({ mark: 'spawn', pid: p.pid });

let raw = '', exited = null, lastProcs = [];
p.onData((d) => { rec({ data: d }); raw += d; term.write(d); });
p.onExit(({ exitCode, signal }) => { exited = { exitCode, signal }; rec({ exit: exitCode, signal }); });
if (sc.answer !== false) term.onData((d) => { rec({ reply: d }); if (!exited) p.write(d); });

if (sc.watchSessionFile) {
  const f = path.join(require('os').homedir(), '.claude', 'sessions', p.pid + '.json');
  let last = null;
  setInterval(() => {
    let c = null;
    try { c = fs.readFileSync(f, 'utf8'); } catch (_) {}
    if (c !== last) { last = c; try { rec({ sessfile: c }); } catch (_) {} }
  }, 100).unref();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function procTree() {
  const js = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress'],
    { encoding: 'utf8', maxBuffer: 1 << 26 });
  const all = JSON.parse(js), res = [], seen = new Set([p.pid]);
  let grew = true;
  while (grew) { grew = false; for (const x of all) if (seen.has(x.ParentProcessId) && !seen.has(x.ProcessId)) { seen.add(x.ProcessId); grew = true; } }
  for (const x of all) if (seen.has(x.ProcessId)) res.push({ pid: x.ProcessId, ppid: x.ParentProcessId, name: x.Name, mb: Math.round(x.WorkingSetSize / 1048576) });
  return res;
}
function killTree(reason) {
  rec({ mark: 'killTree:' + reason });
  const pids = new Set([p.pid, ...lastProcs.map((x) => x.pid)]);
  try { p.kill(); } catch (e) { rec({ mark: 'p.kill error ' + e.message }); }
  // Solo PIDs lanzados por este harness (el hijo del pty y sus descendientes observados). Nunca por nombre.
  for (const pid of pids) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {} }
}

// Lanza un segundo proceso (mismo exe) en otro pty, captura texto y exit; lo mata si sigue vivo tras ms.
function ptyCheck(args, ms) {
  return new Promise((resolve) => {
    const q = pty.spawn(sc.file, args, { name: 'xterm-256color', cols, rows, cwd: sc.cwd || process.cwd(), env });
    fs.appendFileSync(path.join(__dirname, 'pids.log'), `${new Date().toISOString()} ${name}/ptyCheck pid=${q.pid}\n`);
    const v = new Terminal({ cols, rows, scrollback: 500, allowProposedApi: true });
    let out2 = '', ex = null;
    q.onData((d) => { out2 += d; v.write(d); });
    q.onExit(({ exitCode }) => { ex = exitCode; });
    const pid = q.pid;
    const finish = () => {
      const b = v.buffer.active, L = [];
      for (let i = 0; i < b.length; i++) L.push(b.getLine(i).translateToString(true));
      const alive = ex === null;
      if (alive) { try { q.kill(); } catch (_) {} try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch (_) {} }
      setTimeout(() => resolve({ exit: ex, killedByHarness: alive, text: L.join('\n').trim().slice(0, 1500) }), 800);
    };
    const st = Date.now();
    const iv = setInterval(() => { if (ex !== null || Date.now() - st > ms) { clearInterval(iv); setTimeout(finish, 300); } }, 100);
  });
}

async function waitFor(fn, timeout) {
  const st = Date.now();
  while (Date.now() - st < timeout) { if (fn()) return true; if (exited) return !!fn(); await sleep(40); }
  return false;
}

(async () => {
  const hard = setTimeout(() => { rec({ mark: 'HARD_TIMEOUT' }); killTree('hard'); setTimeout(() => process.exit(3), 1500); }, sc.hardTimeoutMs || 180000);
  let rawMark = 0;
  for (const s of sc.steps || []) {
    if (s.wait != null) await sleep(s.wait);
    else if (s.until) {
      const re = new RegExp(s.until, s.flags || 'i'), st = now();
      const ok = await waitFor(() => re.test(screen()), s.timeout || 30000);
      rec({ mark: `until /${s.until}/ ${ok ? 'OK' : 'TIMEOUT'}`, elapsed: now() - st });
      console.error(`[${now()}] until /${s.until}/ ${ok ? 'OK' : 'TIMEOUT'} (${now() - st} ms)`);
      if (!ok && s.bail) break;
    } else if (s.untilRaw) {
      const re = new RegExp(s.untilRaw, s.flags || ''), st = now(), from = rawMark;
      const ok = await waitFor(() => re.test(raw.slice(from)), s.timeout || 30000);
      rec({ mark: `untilRaw /${s.untilRaw}/ ${ok ? 'OK' : 'TIMEOUT'}`, elapsed: now() - st });
      console.error(`[${now()}] untilRaw /${s.untilRaw}/ ${ok ? 'OK' : 'TIMEOUT'} (${now() - st} ms)`);
      if (!ok && s.bail) break;
    } else if (s.write != null) { rec({ in: s.write }); if (!exited) p.write(s.write); rawMark = raw.length; }
    else if (s.ifScreen) {
      const hit = new RegExp(s.ifScreen, s.flags || 'i').test(screen());
      rec({ mark: `ifScreen /${s.ifScreen}/ ${hit}` });
      console.error(`[${now()}] ifScreen /${s.ifScreen}/ ${hit}`);
      if (hit) { rec({ in: s.write }); p.write(s.write); }
    } else if (s.mark) rec({ mark: s.mark });
    else if (s.snap) { await sleep(60); rec({ snap: s.snap, screen: screen() }); }
    else if (s.procs) { try { lastProcs = procTree(); rec({ procs: lastProcs }); console.error('procs', JSON.stringify(lastProcs)); } catch (e) { rec({ mark: 'procs error ' + e.message }); } }
    else if (s.killHard) { rec({ mark: 'taskkill /F /T (pid propio)' }); try { execFileSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) { rec({ mark: 'taskkill err ' + e.message }); } }
    else if (s.ptyCheck) {
      const r = await ptyCheck(s.ptyCheck.args, s.ptyCheck.ms || 6000);
      rec({ ptyCheck: { args: s.ptyCheck.args, ...r } });
      console.error('ptyCheck', JSON.stringify(s.ptyCheck.args).slice(0, 80), 'exit=', r.exit, JSON.stringify(r.text).slice(0, 300));
    }
    else if (s.kill) { rec({ mark: 'pty.kill()' }); try { p.kill(); } catch (e) { rec({ mark: 'kill err ' + e.message }); } }
    else if (s.waitExit != null) { const ok = await waitFor(() => exited, s.waitExit); rec({ mark: `waitExit ${ok ? 'OK' : 'TIMEOUT'}` }); }
  }
  rec({ snap: 'final', screen: screen() });
  clearTimeout(hard);
  if (!exited) killTree('fin-de-guion');
  await waitFor(() => exited, 3000);
  rec({ mark: 'fin', exited: exited || null });
  await sleep(200);
  closed = true;
  fs.closeSync(out);
  console.error(`[fin] ${name} exit=${JSON.stringify(exited)} -> ${outFile}`);
  process.exit(0);
})();
