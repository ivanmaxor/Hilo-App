// Shell falsa para las pruebas: registra cada byte que recibe y escribe texto conocido.
// node sink.cjs <archivo-salida> [--bracket] [--echo] [--mouse]
const { appendFileSync, writeFileSync } = require('node:fs');
const [out, ...flags] = process.argv.slice(2);
writeFileSync(out, '');
if (process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.resume();
if (flags.includes('--bracket')) process.stdout.write('\x1b[?2004h');
if (flags.includes('--mouse')) process.stdout.write('\x1b[?1000h\x1b[?1006h');

// Línea que la terminal va a envolver (no tiene saltos).
process.stdout.write(`INICIO-${'abcdefghij'.repeat(40)}-FIN\r\n`);
// Espacios al final, que no deben copiarse.
process.stdout.write('con-espacios-al-final      \r\n');
process.stdout.write('  sangría conservada\r\n');
process.stdout.write('ñandú áéíóú 😀 日本語\r\n');
process.stdout.write('LISTO\r\n');

process.stdin.on('data', (data) => {
  appendFileSync(out, data);
  if (flags.includes('--quit-on-q') && data.includes('Q')) process.exit(3);
  if (flags.includes('--echo')) process.stdout.write(data);
});
