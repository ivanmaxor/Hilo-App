import { expect, test } from "@playwright/test";
import {
  acceptTrustIfNeeded,
  CLAUDE_ARGS,
  send,
  TRUSTED,
  uuid,
} from "./claude-helpers";
import { cleanup, launch, makeState, waitStatus } from "./helpers";

test("el botón copia el último mensaje de Claude con el nombre de la sesión delante", async () => {
  test.skip(
    process.env.HILO_E2E_CLAUDE !== "1",
    "Definir HILO_E2E_CLAUDE=1 para usar Claude real",
  );
  test.setTimeout(150_000);
  const id = uuid();
  const ctx = await launch({
    state: makeState([{ id, kind: "claude", name: "Mi sesión" }], TRUSTED),
    claudeArgs: CLAUDE_ARGS,
    width: 1400,
    height: 800,
  });
  try {
    const { page, app } = ctx;
    await page.evaluate(
      (sid) => (window as any).__hiloTest.selectSession(sid),
      id,
    );
    await acceptTrustIfNeeded(page, id);
    await waitStatus(page, id, "idle", 40_000);
    await send(
      page,
      id,
      "Sin herramientas, responde exactamente en dos lineas: la primera ALFA y la segunda BETA.",
    );
    await waitStatus(page, id, "done", 60_000);

    await page.locator('[data-action="copy-last-message"]').click();
    await expect(page.locator(".toast").last()).toContainText("Se copió");
    const copied = await app.evaluate(async () =>
      (globalThis as any).__hilo.clipboard.readText(),
    );
    expect(copied).toMatch(/^Mi sesión:\n\nALFA\s*\n+\s*BETA\s*$/);
    await page.screenshot({ path: "test-results/copiar-respuesta.png" });
  } finally {
    await ctx.close();
    cleanup(ctx.dataDir);
  }
});
