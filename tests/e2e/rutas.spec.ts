import {
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, launch, makeState, newDataDir, status } from "./helpers";

// Rutas clicables en la terminal (#10, D35): un clic muestra el archivo en el Explorador, Ctrl+clic lo abre en el IDE.
// En modo prueba Hilo anota lo que mostraría en el Explorador (`revealedPaths`) en vez de abrirlo.

const A = "aaaaaaaa-7777-4000-8000-00000000000a";

const revealed = (app: ElectronApplication) =>
  app.evaluate(
    () =>
      (globalThis as any).__hilo.revealedPaths as {
        path: string;
        dir: boolean;
      }[],
  );

/** El centro de la letra `offset` de `needle` en la pantalla de la terminal. */
async function pointAt(
  page: Page,
  needle: string,
  offset = 1,
): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(
    ([id, text, off]) => {
      const term = (window as any).__hiloTest.terminals.debugEntry(id).term;
      const buffer = term.buffer.active;
      for (let y = 0; y < buffer.length; y++) {
        const x = buffer.getLine(y).translateToString(true).indexOf(text);
        if (x === -1) continue;
        const screen = term.element
          .querySelector(".xterm-screen")
          .getBoundingClientRect();
        const cell = {
          w: screen.width / term.cols,
          h: screen.height / term.rows,
        };
        return {
          x: screen.left + (x + (off as number) + 0.5) * cell.w,
          y: screen.top + (y - buffer.viewportY + 0.5) * cell.h,
        };
      }
      return null;
    },
    [A, needle, offset] as const,
  );
  if (!point) throw new Error(`no está en la terminal: ${needle}`);
  return point;
}

async function hover(
  page: Page,
  needle: string,
  offset = 1,
): Promise<{ x: number; y: number }> {
  const point = await pointAt(page, needle, offset);
  await page.mouse.move(point.x - 30, point.y);
  await page.mouse.move(point.x, point.y);
  return point;
}

test("las rutas de la terminal se subrayan si existen, y el clic las muestra o las abre", async () => {
  const project = join(newDataDir(), "proyecto");
  mkdirSync(join(project, "src"), { recursive: true });
  mkdirSync(join(project, "docs"), { recursive: true });
  writeFileSync(join(project, "src", "app.ts"), "");
  writeFileSync(join(project, "docs", "mi informe.md"), "");
  const state = makeState([{ id: A, name: "Uno" }], project);
  // Letra chica: en una pantalla de 1024 px (la del CI) la ventana se recorta, la línea con la ruta completa se parte en dos filas
  // y `mi informe.md` queda cortado. Con 9 px (el mínimo) entra entera, y la prueba no depende del ancho ni de la carpeta temporal.
  state.settings.fontSize = 9;
  state.ui = {
    ...state.ui,
    activeSessionId: A,
    panes: [A],
    layout: 1,
    activePane: 0,
  };
  const ctx = await launch({ state });
  try {
    const { page, app } = ctx;
    await page.evaluate((id) => (window as any).__hiloTest.wakeSession(id), A);
    await expect
      .poll(() => status(page, A), { timeout: 15_000 })
      .not.toBe("asleep");
    await page.waitForTimeout(500);
    const lines = [
      "Edité src/app.ts:12 y no-existe/otra.ts",
      `Informe en ${project}\\docs\\mi informe.md listo`,
      "Red: \\\\servidor\\carpeta\\a.txt",
    ];
    await page.evaluate(
      ([id, text]) =>
        new Promise<void>((done) =>
          (window as any).__hiloTest.terminals
            .debugEntry(id)
            .term.write(text, () => done()),
        ),
      [A, "\x1b[2J\x1b[3J\x1b[H" + lines.join("\r\n") + "\r\n"] as const,
    );
    const tip = page.locator(".link-tip");

    // Una ruta del proyecto: el aviso dice qué hace cada clic, y el clic la muestra en el Explorador.
    const app_ts = await hover(page, "src/app.ts");
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(
      "Clic: mostrar en el Explorador · Ctrl+clic: abrir en el IDE del proyecto",
    );
    await page.mouse.click(app_ts.x, app_ts.y);
    await expect
      .poll(() => revealed(app))
      .toEqual([{ path: join(project, "src", "app.ts"), dir: false }]);

    // Una que no existe no se subraya ni hace nada.
    const missing = await hover(page, "no-existe/otra.ts");
    await page.waitForTimeout(400);
    await expect(tip).toBeHidden();
    await page.mouse.click(missing.x, missing.y);
    await page.waitForTimeout(300);
    expect(await revealed(app)).toHaveLength(1);

    // Una ruta completa con espacios en el nombre.
    const spaced = await hover(page, "mi informe.md", 5);
    await expect(tip).toBeVisible();
    await page.screenshot({ path: "test-results/rutas.png" });
    await page.mouse.click(spaced.x, spaced.y);
    await expect
      .poll(async () => (await revealed(app)).at(-1))
      .toEqual({ path: join(project, "docs", "mi informe.md"), dir: false });

    // Ctrl+clic: al IDE del proyecto, en su línea. Sin IDE elegido, sale el diálogo para elegirlo.
    await hover(page, "src/app.ts");
    await page.keyboard.down("Control");
    await page.mouse.click(app_ts.x, app_ts.y);
    await page.keyboard.up("Control");
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__hiloTest.view.get().modal),
      )
      .toMatchObject({
        type: "ide",
        projectId: "proy",
        file: "src/app.ts",
        line: 12,
      });
    await page.keyboard.press("Escape");

    // El proceso principal no mira rutas de red, ni rutas con flujos alternativos.
    const answer = await page.evaluate(
      (id) =>
        (window as any).hilo.pathResolve(id, [
          "\\\\servidor\\carpeta\\a.txt",
          "src",
          "src/app.ts:x",
          "C:\\x\\..\\..\\CON",
        ]),
      A,
    );
    expect(answer).toEqual([
      null,
      { abs: join(project, "src"), dir: true, rel: "src" },
      null,
      null,
    ]);

    // La carpeta de la sesión: desde la barra de arriba y desde su menú.
    await page
      .locator('.view-tools [data-action="open-session-folder"]')
      .click();
    await expect
      .poll(async () => (await revealed(app)).at(-1))
      .toEqual({ path: project, dir: true });
    await page.locator(`.row[data-session="${A}"]`).click({ button: "right" });
    await page.locator('.menu [data-action="open-session-folder"]').click();
    await expect.poll(async () => (await revealed(app)).length).toBe(4);
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
