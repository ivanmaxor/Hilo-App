import { expect, test } from "@playwright/test";
import { cleanup, launch, makeState } from "./helpers";

test("perfil de la sesión: descripción, id y una bitácora de notas, desde el ícono de la fila", async () => {
  const state = makeState([
    { id: "a", name: "Login", kind: "claude" },
    { id: "b", name: "Pagos" },
  ]);
  // Hasta la 1.4.0 había una sola nota: llega como la primera entrada de la bitácora.
  (state.projects[0]!.sessions[1] as unknown as { note: string }).note =
    "nota de antes";
  const ctx = await launch({ state });
  try {
    const { page } = ctx;
    const row = page.locator('.row[data-session="a"]');
    const dialog = page.locator(".dialog", { hasText: "Perfil de «Login»" });

    // Sin notas, el ícono aparece al pasar el ratón, y un clic abre el perfil sin el menú.
    await row.hover();
    await row.locator('[data-action="profile"]').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-field="claude-id"]')).toHaveText(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    await expect(dialog).toContainText("Todavía no hay notas.");

    // Ctrl+Enter agrega una nota sin cerrar; el botón, otra. La más nueva va arriba.
    await dialog
      .locator('[data-field="note"]')
      .fill("Probé el login con Google");
    await dialog.locator('[data-field="note"]').press("Control+Enter");
    await dialog.locator('[data-field="note"]').fill("Falta el de GitHub");
    await dialog.locator('[data-action="add-note"]').click();
    const entries = dialog.locator(".profile-log li");
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toContainText("Falta el de GitHub");
    await expect(entries.nth(0).locator("time")).toContainText("hoy");
    await expect(entries.nth(1)).toContainText("Probé el login con Google");

    // Editar una nota.
    await entries.nth(1).locator('[data-action="edit-note"]').click();
    await dialog
      .locator('[data-field="note-edit"]')
      .fill("Probé el login con Google: anda");
    await dialog.locator('[data-action="save-note-edit"]').click();
    await expect(entries.nth(1)).toContainText(
      "Probé el login con Google: anda",
    );

    // Borrar se puede deshacer.
    await entries.nth(0).locator('[data-action="delete-note"]').click();
    await expect(entries).toHaveCount(1);
    await page.locator(".toast button", { hasText: "Deshacer" }).click();
    await expect(entries).toHaveCount(2);

    // Guardar deja el nombre y la descripción.
    await dialog
      .locator('[data-field="profile-name"]')
      .fill("Login con Google");
    await dialog
      .locator('[data-field="description"]')
      .fill("Probar los inicios de sesión");
    await dialog.locator('[data-action="save-note"]').click();
    await expect(dialog).toBeHidden();
    await expect(row.locator(".name")).toHaveText("Login con Google");
    await expect(row.locator(".note-mark")).toBeVisible();
    await expect(row).toHaveAttribute("title", /Probar los inicios de sesión/);
    await expect(row).toHaveAttribute(
      "title",
      /Última nota: Falta el de GitHub/,
    );

    // Lo de antes de la 1.4.1 sigue ahí, como nota.
    const other = page.locator('.row[data-session="b"]');
    await expect(other.locator(".note-mark")).toBeVisible();
    await other.locator('[data-action="profile"]').click();
    const otherDialog = page.locator(".dialog", {
      hasText: "Perfil de «Pagos»",
    });
    await expect(otherDialog.locator(".profile-log li")).toHaveCount(1);
    await expect(otherDialog.locator(".profile-log li")).toContainText(
      "nota de antes",
    );
    // Una PowerShell no tiene conversación de Claude que retomar.
    await expect(otherDialog.locator('[data-field="claude-id"]')).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
    await expect(otherDialog).toBeHidden();
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
