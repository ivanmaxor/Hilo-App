// probe.js - calibracion de ConPTY: emite secuencias conocidas con marcadores para ver cuales pasan
// y registra lo que le llega por stdin en modo raw. argv[2]=archivo de log de stdin, argv[3]=ms de vida.
const fs = require('fs');
const log = process.argv[2];
const E = '\x1b', B = '\x07', ST = '\x1b\\';
const cases = [
  ['osc0', `${E}]0;titulo-osc0${B}`], ['osc1', `${E}]1;icono-osc1${B}`], ['osc2', `${E}]2;titulo-osc2${B}`], ['osc0-st', `${E}]0;titulo-osc0-st${ST}`],
  ['osc7', `${E}]7;file://host/c:/x${B}`], ['osc8', `${E}]8;;https://ejemplo.test${ST}link${E}]8;;${ST}`],
  ['osc9', `${E}]9;notif-osc9${B}`], ['osc9-4-3', `${E}]9;4;3;0${B}`], ['osc9-4-1', `${E}]9;4;1;50${ST}`], ['osc9-4-0', `${E}]9;4;0;0${B}`],
  ['osc133', `${E}]133;A${B}`], ['osc633', `${E}]633;A${B}`], ['osc777', `${E}]777;notify;T;B${B}`], ['osc1337', `${E}]1337;RequestAttention=yes${B}`], ['osc99', `${E}]99;;hola${ST}`],
  ['bel', B], ['bel2', `abc${B}def`],
  ...[1004, 2004, 1049, 25, 2026, 1000, 1002, 1003, 1006, 9001, 2031, 2027].flatMap((m) => [[`?${m}h`, `${E}[?${m}h`], [`?${m}l`, `${E}[?${m}l`]]),
  ['kitty>1u', `${E}[>1u`], ['kitty?u', `${E}[?u`], ['kitty<u', `${E}[<u`], ['kitty=1u', `${E}[=1;1u`], ['mok', `${E}[>4;2m`],
  ['DA1', `${E}[c`], ['DA2', `${E}[>c`], ['XTVERSION', `${E}[>0q`], ['DSR6', `${E}[6n`], ['DECRQM2026', `${E}[?2026$p`], ['OSC10?', `${E}]10;?${B}`], ['DCS-tmux', `${E}Ptmux;x${ST}`], ['APC', `${E}_Gi=1;a${ST}`],
];
try { process.stdin.setRawMode(true); } catch (e) { fs.appendFileSync(log, 'noraw ' + e.message + '\n'); }
process.stdin.on('data', (d) => fs.appendFileSync(log, JSON.stringify({ t: Date.now(), hex: d.toString('hex'), s: d.toString('utf8') }) + '\n'));
process.stdin.resume();
process.stdout.write('PROBE-START\r\n');
let i = 0;
const tick = () => {
  if (i >= cases.length) { process.stdout.write('PROBE-DONE\r\n'); return; }
  const [n, s] = cases[i++];
  process.stdout.write(`<${n}>${s}</${n}>\r\n`);
  setTimeout(tick, 60);
};
setTimeout(tick, 400);
setTimeout(() => { process.stdout.write('PROBE-EXIT\r\n'); process.exit(7); }, Number(process.argv[3] || 12000));
