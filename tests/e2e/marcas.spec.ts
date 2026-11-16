import { expect, test } from "@playwright/test";
import { cleanup, launch, makeState, settle } from "./helpers";

test("marca, nota, no leída y un color propio desde el menú de la sesión", async () => {
  const state = makeState([
    { id: "a", name: "Login" },
    { id: "b", name: "Pagos" },
  ]);
  const ctx = await launch({ state });
  try {
    const { page } = ctx;
    const row = page.locator('.row[data-session="a"]');
    const menu = () => row.click({ button: "right" });

    await menu();
    await page
      .locator(".menu .menu-marks .mark-pick", { hasText: "🔥" })
      .click();
    await expect(row.locator(".mark")).toHaveText("🔥");

    await menu();
    await page.locator('[data-action="note"]').click();
    await page
      .locator('[data-field="note"]')
      .fill("Falta probar el login con Google");
    await page.locator('[data-action="save-note"]').click();
    await expect(row.locator(".note-mark")).toBeVisible();
    // Dormida: la nota se ve en su panel.
    await row.click();
    await expect(page.locator(".overlay-note")).toContainText(
      "Falta probar el login con Google",
    );

    // No leída a mano: se va al abrirla.
    await page.locator('.row[data-session="b"]').click();
    await menu();
    await page.locator('[data-action="mark-unread"]').click();
    await expect(row).toHaveClass(/unread/);
    await menu();
    await page.locator('[data-action="mark-read"]').click();
    await expect(row).not.toHaveClass(/unread/);

    // Un color fuera de la paleta queda entre los recientes.
    await menu();
    await page.locator('.menu [data-action="more-colors"]').click();
    await page.locator(".cp-hex").fill("#ff8800");
    await page.locator('[data-action="use-color"]').click();
    await expect(row).toHaveAttribute("style", /#ff8800/);
    await menu();
    await expect(
      page.locator('.menu .swatches.recent .swatch[title="Reciente: #ff8800"]'),
    ).toBeVisible();
    await page
      .locator(".menu .cp-hint, .menu")
      .first()
      .screenshot({ path: "test-results/marcas-menu.png" });
    await page.keyboard.press("Escape");

    await expect(
      page.locator('.project-head [data-action="open-folder"]'),
    ).toHaveCount(1);
    await settle(300);
    await page.screenshot({ path: "test-results/marcas.png" });
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
