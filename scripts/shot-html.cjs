// Captura un HTML local con Electron: electron scripts/shot-html.cjs <salida.png> <ancho> <alto> <archivo.html>
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const [out, w, h, file] = process.argv.slice(-4);
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: Number(w), height: Number(h), show: false, useContentSize: true, x: 20, y: 20 });
  await win.loadFile(file);
  win.showInactive();
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage();
  writeFileSync(out, image.toPNG());
  app.exit(0);
});

