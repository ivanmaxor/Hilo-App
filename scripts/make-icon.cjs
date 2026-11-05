// Genera assets/icon.ico desde un SVG: electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

// Un hilo que pasa por tres nudos, los estados que importan: gris, amarillo, verde.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1b1c20"/>
  <path d="M32 7 C 18 18, 46 26, 32 32 S 18 48, 32 57" fill="none" stroke="#7fa8d8" stroke-width="4" stroke-linecap="round"/>
  <circle cx="32.5" cy="16.5" r="6" fill="#a3a5ae"/>
  <circle cx="32" cy="32" r="6" fill="#e9c05c"/>
  <circle cx="31.5" cy="47.5" r="6" fill="#5ecb8b"/>
</svg>`;

const SIZES = [16, 24, 32, 48, 64, 128, 256];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  // Una sola captura grande; las ventanas de Windows no bajan de cierto tamaño.
  const base = 512;
  const file = join(tmpdir(), 'hilo-icon.html');
  writeFileSync(file, `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg.replace('<svg ', `<svg width="${base}" height="${base}" `)}</body></html>`);
  const win = new BrowserWindow({ width: base, height: base, show: false, frame: false, transparent: true, useContentSize: true, x: 10, y: 10 });
  await win.loadFile(file);
  win.showInactive();
  await new Promise((r) => setTimeout(r, 500));
  const big = await win.webContents.capturePage({ x: 0, y: 0, width: base, height: base });
  win.destroy();
  rmSync(file, { force: true });
  const images = SIZES.map((size) => ({ size, png: big.resize({ width: size, height: size, quality: 'best' }).toPNG() }));
  // ICO con las imágenes en PNG.
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  const out = join(__dirname, '..', 'assets');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...images.map((i) => i.png)]));
  writeFileSync(join(out, 'icon-256.png'), images[images.length - 1].png);
  app.exit(0);
});
