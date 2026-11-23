import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, launch, makeState, newDataDir, settle } from "./helpers";

const settings = (page: Page) =>
  page.evaluate(() => (window as any).__hiloTest.app.get().state.settings);
const played = (page: Page) =>
  page.evaluate(() =>
    (window as any).__hiloTest.playedSounds.map(
      (p: any) => `${p.id}:${p.sound}`,
    ),
  );
const openSettings = (page: Page) =>
  page.evaluate(() => (window as any).__hiloTest.runCommand("settings"));

/** Un WAV de 0,2 s de silencio: lo justo para que exista un audio válido. */
function tinyWav(file: string): void {
  const rate = 8000;
  const samples = rate / 5;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples * 2, 40);
  writeFileSync(file, buf);
}

test("los Ajustes van por módulos, con buscador y restablecer", async () => {
  const state = makeState([]);
  state.settings.theme = "light";
  const ctx = await launch({ state });
  try {
    const { page } = ctx;
    await openSettings(page);
    await expect(page.locator(".set-module")).toHaveCount(1);
    await expect(page.locator(".set-module h3")).toHaveText("Apariencia");

    // El buscador junta opciones de todos los módulos.
    await page.locator('[data-field="settings-search"]').fill("volumen");
    await expect(page.locator(".set-module:visible h3")).toHaveText(["Avisos", "Novedades"]);
    await expect(page.locator('[data-field="sound-volume"]')).toBeVisible();
    await page.locator('[data-field="settings-search"]').fill("zzzz");
    await expect(page.locator(".set-empty")).toBeVisible();
    await page.locator('[data-field="settings-search"]').fill("");

    // Restablecer pide confirmación y vuelve a los valores de fábrica solo en ese módulo.
    await page.locator('[data-action="reset-module"]').click();
    await page.locator('[data-action="reset-confirm"]').click();
    await expect.poll(async () => (await settings(page)).theme).toBe("dark");
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});

test("el sonido propio se elige, suena en los avisos y se quita", async () => {
  const dir = newDataDir();
  mkdirSync(dir, { recursive: true });
  const wav = join(dir, "mi-aviso.wav");
  tinyWav(wav);
  const ctx = await launch({
    state: makeState([{ id: "a", name: "Uno" }]),
    env: { HILO_TEST_SOUND_FILE: wav },
  });
  try {
    const { page, app } = ctx;
    await openSettings(page);
    await page.locator(".settings-nav button", { hasText: "Avisos" }).click();
    await page.locator('[data-action="pick-sound"]').click();
    await expect
      .poll(async () => (await settings(page)).customSoundName)
      .toBe("mi-aviso.wav");
    await page.locator('select[data-field="soundDone"]').selectOption("propio");

    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.send(
        "session:alert",
        "a",
        "done",
        true,
      ),
    );
    await expect.poll(() => played(page)).toEqual(["a:propio"]);

    await page.locator('[data-action="clear-sound"]').click();
    await expect
      .poll(async () => (await settings(page)).customSoundName)
      .toBe("");
    expect((await settings(page)).soundDone).toBe("gota");
    await expect(
      page.locator('select[data-field="soundDone"] option[value="propio"]'),
    ).toHaveCount(0);
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
    cleanup(dir);
  }
});

test("un umbral de uso avisa una vez, y al reabrir no se repite", async () => {
  const dataDir = newDataDir();
  const state = makeState([]);
  state.settings.usageAlertSession = [80];
  state.settings.usageAlertWeek = [];
  const now = Math.floor(Date.now() / 1000);
  const usage = JSON.stringify({
    at: now,
    five_hour: { used: 86, resets_at: now + 3600, changed: now },
  });
  const first = await launch({ state, dataDir });
  try {
    const { page, app } = first;
    mkdirSync(join(dataDir, "hooks"), { recursive: true });
    writeFileSync(
      join(dataDir, "hooks", "usage-11111111-2222-4333-8444-555555555555.json"),
      usage,
    );
    await expect(page.locator(".toast").last()).toContainText(
      "Llevas el 86 % de tu sesión de 5 horas",
      { timeout: 10_000 },
    );
    await expect.poll(() => played(page)).toEqual(["uso-session:campana"]);
    const sent = await app.evaluate(
      () =>
        (globalThis as any).__hilo.sentNotifications.filter(
          (n: any) => n.status === "usage",
        ).length,
    );
    expect(sent).toBe(1);
  } finally {
    await first.close();
  }
  const second = await launch({ dataDir });
  try {
    await settle(2000);
    expect(await played(second.page)).toEqual([]);
  } finally {
    await second.close();
    cleanup(dataDir);
  }
});
