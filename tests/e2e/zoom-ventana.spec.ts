import { expect, test, type Page } from "@playwright/test";
import { cleanup, launch, makeState } from "./helpers";

/** El hueco de los botones de la ventana (Window Controls Overlay) y la barra de pestañas, en px de la página. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const wco = (
      navigator as unknown as {
        windowControlsOverlay: {
          visible: boolean;
          getTitlebarAreaRect(): DOMRect;
        };
      }
    ).windowControlsOverlay;
    const area = wco.getTitlebarAreaRect();
    const bar = document.querySelector(".tabbar")!.getBoundingClientRect();
    const tools = document
      .querySelector(".view-tools")!
      .getBoundingClientRect();
    return {
      visible: wco.visible,
      areaRight: area.x + area.width,
      areaHeight: area.height,
      barHeight: bar.height,
      toolsRight: tools.right,
    };
  });

/** Los botones de la ventana miden lo que la barra (el alto va en px enteros de la pantalla) y no tapan nada de ella. */
async function expectFits(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      const m = await measure(page);
      return (
        m.visible &&
        Math.abs(m.areaHeight - m.barHeight) <= 1.5 &&
        m.toolsRight <= m.areaRight
      );
    })
    .toBe(true);
}

test("los botones de la ventana siguen el zoom de la interfaz y no tapan la barra (#60)", async () => {
  const state = makeState([{ id: "a", name: "Uno" }]);
  state.settings.appZoom = 80;
  state.settings.theme = "light";
  const ctx = await launch({ state });
  try {
    const { page } = ctx;
    await page.locator(".view-tools").waitFor();
    // Al abrir con el 80 %: antes medían 36 px de alto y tapaban el final de la barra.
    await expectFits(page);

    await page.evaluate(() =>
      (window as any).__hiloTest.runCommand("settings"),
    );
    // Cambiar el tema vuelve a pintar los botones: tienen que conservar el alto del zoom.
    await page.locator('[data-field="theme"]').selectOption("dark");
    await expectFits(page);

    // Y al cambiar el zoom con la app abierta, en las dos direcciones.
    await page.locator('[data-field="app-zoom"]').selectOption("150");
    await expectFits(page);
    await page.locator('[data-field="app-zoom"]').selectOption("90");
    await expectFits(page);
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
