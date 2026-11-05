#!/usr/bin/env node
// analyze.js - extrae de un .jsonl de record.js: OSC, BEL sueltos, DEC private modes, kitty/CSI u,
// queries al terminal, DCS/APC, y linea de tiempo con marcas e inputs. t = ms desde spawn.
// Uso: node analyze.js <archivo.jsonl> [--events] [--titles] [--json] [--screens]
const fs = require('fs');
const file = process.argv[2];
const flags = new Set(process.argv.slice(3));
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const MODE = { 1: 'DECCKM', 12: 'cursor-blink', 25: 'cursor-visible', 47: 'altscreen47', 1000: 'mouse-x11', 1002: 'mouse-btn', 1003: 'mouse-any', 1004: 'focus', 1005: 'mouse-utf8', 1006: 'mouse-sgr', 1015: 'mouse-urxvt', 1047: 'altscreen1047', 1048: 'save-cursor', 1049: 'altscreen1049', 2004: 'bracketed-paste', 2026: 'sync-output', 2027: 'grapheme', 2031: 'color-scheme-notify', 9001: 'win32-input-mode', 7: 'autowrap', 6: 'origin' };
const ev = []; // {t, kind, ...}
const S = { st: 'G', buf: '' }; // G=ground, E=esc, C=csi, O=osc, D=dcs/apc/pm, OE/DE=esc dentro de string
let bytes = 0, chunks = 0, sgr = 0, cup = 0;
function csi(t, s) {
  const final = s[s.length - 1], body = s.slice(0, -1);
  let m;
  if ((m = /^\?([\d;]+)$/.exec(body)) && (final === 'h' || final === 'l')) {
    for (const n of m[1].split(';')) ev.push({ t, kind: 'mode', mode: +n, name: MODE[+n] || '?', set: final === 'h', seq: `CSI ? ${n} ${final}` });
  } else if (final === 'u' && /^[?>=<]/.test(body)) ev.push({ t, kind: 'kitty', seq: `CSI ${body} u` });
  else if (final === 'u' && /^\d/.test(body)) ev.push({ t, kind: 'csi-u', seq: `CSI ${body} u` });
  else if (final === 'u' && body === '') ev.push({ t, kind: 'scorc', seq: 'CSI u' });
  else if (final === 'm' && /^>/.test(body)) ev.push({ t, kind: 'modifyOtherKeys', seq: `CSI ${body} m` });
  else if (final === 'p' && /\$$/.test(body)) ev.push({ t, kind: 'query', seq: `CSI ${body}p (DECRQM)` });
  else if (final === 'n') ev.push({ t, kind: 'query', seq: `CSI ${body}n (DSR)` });
  else if (final === 'c') ev.push({ t, kind: 'query', seq: `CSI ${body}c (DA)` });
  else if (final === 'q' && body[0] === '>') ev.push({ t, kind: 'query', seq: `CSI ${body}q (XTVERSION)` });
  else if (final === 'q' && body.endsWith(' ')) ev.push({ t, kind: 'cursor-style', seq: `CSI ${body}q (DECSCUSR)` });
  else if (final === 't') ev.push({ t, kind: 'winop', seq: `CSI ${body}t` });
  else if (final === 'J' && (body === '2' || body === '3')) ev.push({ t, kind: 'clear', seq: `CSI ${body}J` });
  else if (final === 'm') sgr++;
  else if (final === 'H') cup++;
}
function osc(t, s, term) {
  const i = s.indexOf(';');
  const id = i < 0 ? s : s.slice(0, i);
  const payload = i < 0 ? '' : s.slice(i + 1);
  ev.push({ t, kind: 'osc', id, payload, term });
}
for (const r of lines) {
  if (r.data == null) continue;
  chunks++; bytes += Buffer.byteLength(r.data);
  const t = r.t;
  for (const ch of r.data) {
    const c = ch.codePointAt(0);
    switch (S.st) {
      case 'G':
        if (c === 0x1b) S.st = 'E';
        else if (c === 7) ev.push({ t, kind: 'bel' });
        else if (c === 0x9d) { S.st = 'O'; S.buf = ''; }
        break;
      case 'E':
        if (ch === '[') { S.st = 'C'; S.buf = ''; }
        else if (ch === ']') { S.st = 'O'; S.buf = ''; }
        else if (ch === 'P' || ch === '_' || ch === '^' || ch === 'X') { S.st = 'D'; S.buf = ''; S.intro = ch; }
        else if (ch === '(' || ch === ')' || ch === '#' || ch === '%' || ch === ' ') S.st = 'I';
        else { ev.push({ t, kind: 'esc', seq: 'ESC ' + ch }); S.st = 'G'; }
        break;
      case 'I': S.st = 'G'; break;
      case 'C':
        S.buf += ch;
        if (c >= 0x40 && c <= 0x7e) { csi(t, S.buf); S.st = 'G'; }
        break;
      case 'O':
        if (c === 7) { osc(t, S.buf, 'BEL'); S.st = 'G'; }
        else if (c === 0x1b) S.st = 'OE';
        else if (c === 0x9c) { osc(t, S.buf, 'ST'); S.st = 'G'; }
        else S.buf += ch;
        break;
      case 'OE':
        if (ch === '\\') { osc(t, S.buf, 'ST'); S.st = 'G'; } else { osc(t, S.buf, 'ESC?'); S.st = 'E'; }
        break;
      case 'D':
        if (c === 0x1b) S.st = 'DE';
        else if (c === 0x9c) { ev.push({ t, kind: 'dcs', intro: S.intro, payload: S.buf }); S.st = 'G'; }
        else S.buf += ch;
        break;
      case 'DE':
        ev.push({ t, kind: 'dcs', intro: S.intro, payload: S.buf });
        S.st = ch === '\\' ? 'G' : 'E';
        break;
    }
  }
}
const fmt = (s) => JSON.stringify(s).slice(1, -1);
const titles = ev.filter((e) => e.kind === 'osc' && ['0', '1', '2'].includes(e.id));
const meta = (lines.find((l) => l.meta) || {}).meta;
const firstData = lines.find((l) => l.data != null);
const exit = lines.find((l) => l.exit !== undefined);
const lastT = lines[lines.length - 1].t;

if (flags.has('--json')) { console.log(JSON.stringify({ meta, ev })); process.exit(0); }

console.log(`# ${file.split(/[\\/]/).pop()}`);
console.log('meta:', JSON.stringify(meta));
console.log(`chunks=${chunks} bytes=${bytes} primer_byte=${firstData && firstData.t}ms SGR=${sgr} CUP=${cup} duracion=${lastT}ms exit=${exit ? JSON.stringify({ code: exit.exit, signal: exit.signal, t: exit.t }) : 'n/a'}`);

console.log('\n## Linea de tiempo marcas/input');
for (const r of lines) {
  if (r.mark) console.log(`${String(r.t).padStart(7)} mark  ${r.mark}${r.elapsed != null ? ` (${r.elapsed}ms)` : ''}`);
  else if (r.in != null) console.log(`${String(r.t).padStart(7)} in    ${fmt(r.in)}`);
  else if (r.reply != null) console.log(`${String(r.t).padStart(7)} reply ${fmt(r.reply)}`);
}

console.log('\n## OSC por id');
const byId = {};
for (const e of ev.filter((x) => x.kind === 'osc')) (byId[e.id] = byId[e.id] || []).push(e);
for (const [id, arr] of Object.entries(byId)) {
  const pl = {};
  arr.forEach((a) => { pl[a.payload] = (pl[a.payload] || 0) + 1; });
  console.log(`OSC ${id}: n=${arr.length} term=${[...new Set(arr.map((a) => a.term))]} t=[${arr[0].t}..${arr[arr.length - 1].t}] payloads_distintos=${Object.keys(pl).length}`);
  if (Object.keys(pl).length <= 40) for (const [k, v] of Object.entries(pl)) console.log(`   x${v} ${fmt(k)}`);
}

console.log('\n## Titulos (OSC 0/1/2): cambios');
let prev = null;
const changes = [];
for (const e of titles) if (e.payload !== prev) { changes.push(e); prev = e.payload; }
const show = flags.has('--titles') ? changes : changes.slice(0, 60);
let lastTt = null;
for (const e of show) { console.log(`${String(e.t).padStart(7)} +${String(lastTt == null ? 0 : e.t - lastTt).padStart(5)} OSC ${e.id} ${fmt(e.payload)}`); lastTt = e.t; }
if (changes.length > show.length) console.log(`... (${changes.length - show.length} cambios mas; usa --titles)`);
const iv = [];
for (let i = 1; i < changes.length; i++) iv.push(changes[i].t - changes[i - 1].t);
if (iv.length) { const srt = [...iv].sort((a, b) => a - b); console.log(`intervalos entre cambios: n=${iv.length} min=${srt[0]} mediana=${srt[srt.length >> 1]} max=${srt[srt.length - 1]}`); }
const gl = {};
for (const e of titles) {
  const g = [...e.payload][0] || '';
  const cp = g.codePointAt(0);
  if (cp > 127) { const k = `U+${cp.toString(16).toUpperCase()} ${g}`; gl[k] = (gl[k] || 0) + 1; }
}
console.log('primer glifo no-ASCII de titulos:', JSON.stringify(gl));

console.log('\n## BEL fuera de OSC');
const bels = ev.filter((e) => e.kind === 'bel');
console.log(bels.length ? bels.map((b) => b.t).join(', ') : '(ninguno)');

console.log('\n## DEC private modes (orden temporal; ?25 y ?2026 solo con --events)');
for (const e of ev.filter((x) => x.kind === 'mode')) if (flags.has('--events') || ![25, 2026].includes(e.mode)) console.log(`${String(e.t).padStart(7)} ?${e.mode}${e.set ? 'h' : 'l'} ${e.name}`);
const modeCount = {};
ev.filter((x) => x.kind === 'mode').forEach((e) => {
  const k = `?${e.mode}${e.set ? 'h' : 'l'} ${e.name}`;
  modeCount[k] = modeCount[k] || { n: 0, first: e.t, last: e.t };
  modeCount[k].n++; modeCount[k].last = e.t;
});
console.log('resumen:');
for (const [k, v] of Object.entries(modeCount)) console.log(`  ${k}: n=${v.n} primero=${v.first} ultimo=${v.last}`);

console.log('\n## Kitty / CSI u / modifyOtherKeys / queries / otros');
for (const e of ev.filter((x) => ['kitty', 'csi-u', 'modifyOtherKeys', 'query', 'winop', 'cursor-style', 'esc', 'scorc'].includes(x.kind)).slice(0, 60)) console.log(`${String(e.t).padStart(7)} ${e.kind} ${e.seq}`);
for (const e of ev.filter((x) => x.kind === 'dcs').slice(0, 20)) console.log(`${String(e.t).padStart(7)} DCS/APC(${e.intro}) ${fmt(e.payload)}`);
const clr = ev.filter((x) => x.kind === 'clear');
console.log(`clear (CSI 2J/3J): n=${clr.length} ${clr.slice(0, 10).map((e) => e.t + ':' + e.seq).join(' ')}`);

const lastData = [...lines].reverse().find((l) => l.data != null);
if (lastData) { console.log('\n## Ultimo chunk'); console.log(lastData.t, fmt(lastData.data).slice(-400)); }

if (flags.has('--screens')) {
  console.log('\n## Pantallas');
  for (const r of lines) if (r.snap) { console.log(`--- ${r.t} snap=${r.snap}`); console.log(r.screen); }
}
