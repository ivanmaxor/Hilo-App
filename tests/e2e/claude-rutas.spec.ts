import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  acceptTrustIfNeeded,
  CLAUDE_ARGS,
  send,
  TRUSTED,
  uuid,
} from "./claude-helpers";
import {
  bufferText,
  cleanup,
  launch,
  makeState,
  newDataDir,
  waitStatus,
} from "./helpers";

// Las rutas que escribe Claude de verdad (en azul en su pantalla) también se pueden tocar (#10).
test.describe("Claude real: rutas clicables", () => {
  test.skip(
    process.env.HILO_E2E_CLAUDE !== "1",
    "Definir HILO_E2E_CLAUDE=1 para usar Claude real",
  );
  test.setTimeout(180_000);

  test("la ruta que escribe Claude se muestra en el Explorador con un clic", async () => {
    mkdirSync(join(TRUSTED, "src"), { recursive: true });
    writeFileSync(
      join(TRUSTED, "src", "rutas-prueba.ts"),
      "export const x = 1;\n",
    );
    const id = uuid();
    const state = makeState([{ id, kind: "claude", name: "Rutas" }], TRUSTED);
    state.ui = {
      ...state.ui,
      activeSessionId: id,
      panes: [id],
      layout: 1,
      activePane: 0,
    };
    const ctx = await launch({
      dataDir: newDataDir(),
      state,
      claudeArgs: CLAUDE_ARGS,
    });
    try {
      const { page, app } = ctx;
      await page.evaluate((sid) => (window as any).__hiloTest.selectSession(sid), id);
      await acceptTrustIfNeeded(page, id);
      await waitStatus(page, id, "idle", 30_000);
      await send(
        page,
        id,
        "Sin usar herramientas, responde exactamente esto: Revisa `src/rutas-prueba.ts` en la línea 1.",
      );
      await waitStatus(page, id, "done", 60_000);
      const text = await bufferText(page, id);
      console.log(
        "pantalla:",
        text.split("\n").filter((l) => l.includes("rutas-prueba")),
      );

      const point = await page.evaluate((sid) => {
        const term = (window as any).__hiloTest.terminals.debugEntry(sid).term;
        const buffer = term.buffer.active;
        // La respuesta, no lo que se escribió en el prompt: la última línea que la nombra.
        for (let y = buffer.length - 1; y >= 0; y--) {
          const line = buffer.getLine(y).translateToString(true);
          const x = line.indexOf("rutas-prueba.ts");
          if (x === -1 || line.includes("responde exactamente")) continue;
          const screen = term.element
            .querySelector(".xterm-screen")
            .getBoundingClientRect();
          const cell = {
            w: screen.width / term.cols,
            h: screen.height / term.rows,
          };
          return {
            x: screen.left + (x + 2.5) * cell.w,
            y: screen.top + (y - buffer.viewportY + 0.5) * cell.h,
          };
        }
        return null;
      }, id);
      expect(point).not.toBeNull();
      await page.mouse.move(point!.x - 30, point!.y);
      await page.mouse.move(point!.x, point!.y);
      await expect(page.locator(".link-tip")).toBeVisible();
      console.log("aviso:", await page.locator(".link-tip").textContent());
      await page.mouse.click(point!.x, point!.y);
      await expect
        .poll(() =>
          app.evaluate(() => (globalThis as any).__hilo.revealedPaths),
        )
        .toEqual([
          { path: join(TRUSTED, "src", "rutas-prueba.ts"), dir: false },
        ]);
    } finally {
      await ctx.close();
      cleanup(ctx.dataDir);
    }
  });
});
